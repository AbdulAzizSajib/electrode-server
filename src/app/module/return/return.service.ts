import status from "http-status";
import { RoleName } from "../../constants/role.constant";
import AppError from "../../errorHelpers/AppError";
import {
    AuditAction,
    NotificationType,
    Prisma,
    ReturnStatus,
    StockMovementType,
} from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { IQueryParams } from "../../interfaces/query.interface";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { AuditLogService } from "../audit-log/audit-log.service";
import { CustomerService } from "../customer/customer.service";
import { NotificationService } from "../notification/notification.service";
import { StockService } from "../stock/stock.service";
import { ICreateReturnPayload, IUpdateReturnStatusPayload } from "./return.interface";

const RETURN_INCLUDE = {
    items: { include: { orderItem: true } },
    order: { select: { id: true, orderNumber: true, status: true } },
};

const RETURN_INCLUDE_WITH_CUSTOMER = {
    ...RETURN_INCLUDE,
    customer: { select: { userId: true } },
};

/** Return requests in these statuses don't hold a claim on the ordered quantity (rejected/cancelled free it back up). */
const NON_CONSUMING_STATUSES: ReturnStatus[] = [ReturnStatus.REJECTED, ReturnStatus.CANCELLED];

/**
 * Where a return may go next, from where it is.
 *
 * `COMPLETED` and `CANCELLED` have no successors: they are terminal. That is
 * not tidiness — completing a return RESTOCKS physical goods, so a return that
 * can be moved back and completed again restocks the same delivery twice,
 * inventing inventory the storefront will then sell. The restock guard below
 * (`existing.status !== COMPLETED`) is the second line of defence; this is the
 * first, and it is the one that also stops the status itself from lying about
 * what happened.
 *
 * `REJECTED` keeps a way back to `APPROVED` because rejecting is a judgement an
 * admin can reconsider before any goods move — nothing physical has happened
 * yet, unlike completion.
 */
const RETURN_STATUS_TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
    [ReturnStatus.REQUESTED]: [ReturnStatus.APPROVED, ReturnStatus.REJECTED, ReturnStatus.CANCELLED],
    [ReturnStatus.APPROVED]: [ReturnStatus.RECEIVED, ReturnStatus.REJECTED, ReturnStatus.CANCELLED],
    [ReturnStatus.RECEIVED]: [ReturnStatus.PROCESSING, ReturnStatus.COMPLETED, ReturnStatus.CANCELLED],
    [ReturnStatus.PROCESSING]: [ReturnStatus.COMPLETED, ReturnStatus.CANCELLED],
    [ReturnStatus.REJECTED]: [ReturnStatus.APPROVED, ReturnStatus.CANCELLED],
    [ReturnStatus.COMPLETED]: [],
    [ReturnStatus.CANCELLED]: [],
};

/** The transitions an admin may still make from `from` — the UI offers exactly these. */
const allowedReturnTransitions = (from: ReturnStatus): ReturnStatus[] =>
    RETURN_STATUS_TRANSITIONS[from] ?? [];

const assertReturnTransitionAllowed = (from: ReturnStatus, to: ReturnStatus) => {
    if (from === to) {
        throw new AppError(status.BAD_REQUEST, `Return is already ${to}`);
    }

    if (!allowedReturnTransitions(from).includes(to)) {
        const allowed = allowedReturnTransitions(from);
        throw new AppError(
            status.BAD_REQUEST,
            allowed.length === 0
                ? `A ${from} return is final and cannot be moved to ${to}`
                : `Cannot move a return from ${from} to ${to} — allowed from here: ${allowed.join(", ")}`,
        );
    }
};

const isStaffRole = (role: RoleName) =>
    role === RoleName.OWNER || role === RoleName.ADMIN || role === RoleName.STAFF;

const generateReturnNumber = () => {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `RET-${datePart}-${randomPart}`;
};

const generateUniqueReturnNumber = async (): Promise<string> => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidate = generateReturnNumber();
        const existing = await prisma.returnRequest.findUnique({
            where: { returnNumber: candidate },
            select: { id: true },
        });
        if (!existing) {
            return candidate;
        }
    }
    throw new AppError(status.INTERNAL_SERVER_ERROR, "Failed to generate a unique return number");
};

const createReturn = async (userId: string, orderId: string, payload: ICreateReturnPayload) => {
    const customer = await CustomerService.getOrCreateCustomerByUserId(userId);

    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true },
    });

    if (!order || order.customerId !== customer.id) {
        throw new AppError(status.NOT_FOUND, "Order not found");
    }

    const orderItemsById = new Map(order.items.map((item) => [item.id, item]));

    for (const requested of payload.items) {
        const orderItem = orderItemsById.get(requested.orderItemId);

        if (!orderItem) {
            throw new AppError(
                status.BAD_REQUEST,
                `Order item ${requested.orderItemId} does not belong to this order`,
            );
        }

        const alreadyClaimed = await prisma.returnItem.aggregate({
            where: {
                orderItemId: requested.orderItemId,
                returnRequest: { status: { notIn: NON_CONSUMING_STATUSES } },
            },
            _sum: { quantity: true },
        });

        const claimedSoFar = alreadyClaimed._sum.quantity ?? 0;

        if (claimedSoFar + requested.quantity > orderItem.quantity) {
            throw new AppError(
                status.BAD_REQUEST,
                `Return quantity for "${orderItem.productName}" exceeds what was ordered (ordered ${orderItem.quantity}, already claimed ${claimedSoFar})`,
            );
        }
    }

    const returnNumber = await generateUniqueReturnNumber();

    return prisma.returnRequest.create({
        data: {
            returnNumber,
            orderId,
            customerId: customer.id,
            reason: payload.reason,
            description: payload.description,
            items: {
                create: payload.items.map((item) => ({
                    orderItemId: item.orderItemId,
                    quantity: item.quantity,
                    reason: item.reason,
                })),
            },
        },
        include: RETURN_INCLUDE,
    });
};

const getReturns = async (userId: string, role: RoleName, queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.returnRequest, queryParams, {
        searchableFields: ["returnNumber"],
        filterableFields: ["status", "orderId"],
    });

    queryBuilder.search().filter().sort().paginate().include(RETURN_INCLUDE);

    if (!isStaffRole(role)) {
        const customer = await CustomerService.getOrCreateCustomerByUserId(userId);
        queryBuilder.where({ customerId: customer.id });
    }

    return queryBuilder.execute();
};

const getReturnById = async (userId: string, role: RoleName, returnId: string) => {
    const returnRequest = await prisma.returnRequest.findUnique({
        where: { id: returnId },
        include: RETURN_INCLUDE,
    });

    if (!returnRequest) {
        throw new AppError(status.NOT_FOUND, "Return request not found");
    }

    if (!isStaffRole(role)) {
        const customer = await CustomerService.getOrCreateCustomerByUserId(userId);
        if (returnRequest.customerId !== customer.id) {
            throw new AppError(status.NOT_FOUND, "Return request not found");
        }
    }

    /*
     * Where this return may go next, so the admin offers exactly the
     * transitions the service will accept. Derived from the same map the guard
     * enforces rather than restated client-side: a UI that lists the statuses
     * independently is how a completed return came to be re-completable.
     */
    return { ...returnRequest, allowedTransitions: allowedReturnTransitions(returnRequest.status) };
};

/**
 * Moving a return to `COMPLETED` restocks it — increments `Stock.quantity`
 * at the admin-specified warehouse for each `ReturnItem` and writes a
 * `StockMovement` (`type: RETURN`), mirroring how purchase-order receiving
 * already restocks inventory (per `api/post-purchase` spec). Also applies
 * the same delta to the denormalized `Product`/`ProductVariant.stockQuantity`
 * total, same as every other `Stock`-changing path in this codebase.
 *
 * Takes a transaction client rather than opening its own, so the refund path —
 * which completes a return as part of a larger transaction — restocks through
 * exactly this code instead of a second copy of it. Two implementations of
 * "what completing a return does to stock" is how the two paths came to
 * disagree in the first place.
 */
const restockReturnedItems = async (
    tx: Prisma.TransactionClient,
    returnId: string,
    warehouseId: string,
    items: { productId: string; variantId: string | null; quantity: number }[],
) => {
    for (const item of items) {
        const existingStock = await tx.stock.findFirst({
            where: { warehouseId, productId: item.productId, variantId: item.variantId },
        });

        if (existingStock) {
            await tx.stock.update({
                where: { id: existingStock.id },
                data: { quantity: { increment: item.quantity } },
            });
        } else {
            await tx.stock.create({
                data: { warehouseId, productId: item.productId, variantId: item.variantId, quantity: item.quantity },
            });
        }

        await tx.stockMovement.create({
            data: {
                productId: item.productId,
                variantId: item.variantId,
                warehouseId,
                type: StockMovementType.RETURN,
                quantity: item.quantity,
                referenceId: returnId,
            },
        });

        await StockService.applyDenormalizedStockDelta(tx, item.productId, item.variantId, item.quantity);
    }
};

const updateReturnStatus = async (
    userId: string,
    returnId: string,
    payload: IUpdateReturnStatusPayload,
) => {
    const existing = await prisma.returnRequest.findUnique({
        where: { id: returnId },
        include: RETURN_INCLUDE_WITH_CUSTOMER,
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Return request not found");
    }

    assertReturnTransitionAllowed(existing.status, payload.status);

    if (payload.status === ReturnStatus.COMPLETED && !payload.warehouseId) {
        throw new AppError(
            status.BAD_REQUEST,
            "warehouseId is required to complete a return (it determines where the returned stock is received)",
        );
    }

    /*
     * The restock and the status change commit together. Previously the
     * restock ran in its own transaction and the status update followed
     * separately: a failure in between left the stock added but the return not
     * COMPLETED, so the same goods could be restocked again on the next
     * attempt. The transition guard above now refuses that second attempt, but
     * the two writes still belong to one event and are committed as one.
     */
    const updated = await prisma.$transaction(async (tx) => {
        if (payload.status === ReturnStatus.COMPLETED && existing.status !== ReturnStatus.COMPLETED) {
            await restockReturnedItems(
                tx,
                returnId,
                payload.warehouseId as string,
                existing.items.map((item) => ({
                    productId: item.orderItem.productId,
                    variantId: item.orderItem.variantId,
                    quantity: item.quantity,
                })),
            );
        }

        return tx.returnRequest.update({
            where: { id: returnId },
            data: { status: payload.status },
            include: RETURN_INCLUDE,
        });
    });

    // A status change here can restock physical goods — exactly the event
    // someone will later need to reconstruct when a count does not match.
    await AuditLogService.record(userId, AuditAction.UPDATE, "ReturnRequest", returnId, {
        oldData: existing,
        newData: updated,
    });

    if (existing.customer.userId) {
        await NotificationService.createNotification(
            existing.customer.userId,
            NotificationType.RETURN,
            "Return status updated",
            `Your return ${updated.returnNumber} is now ${payload.status}.`,
        );
    }

    return updated;
};

export const ReturnService = {
    createReturn,
    getReturns,
    getReturnById,
    updateReturnStatus,
    /** Shared with the refund path, which completes a return inside its own transaction — see restockReturnedItems. */
    restockReturnedItems,
    allowedReturnTransitions,
};
