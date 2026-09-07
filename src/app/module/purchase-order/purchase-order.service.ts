import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import {
    AuditAction,
    NotificationType,
    PurchaseOrderStatus,
    StockMovementType,
} from "../../../generated/prisma/client";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { AuditLogService } from "../audit-log/audit-log.service";
import { NotificationService } from "../notification/notification.service";
import { StockService } from "../stock/stock.service";
import { allocateLandedUnitCosts, weightedAverageCost } from "./purchase-order.cost";
import {
    deriveSettlement,
    sumPaymentsByPurchaseOrder,
} from "../supplier-payment/supplier-payment.service";
import {
    IAmendPurchaseOrderPayload,
    ICreatePurchaseOrderPayload,
    IPurchaseOrderItemInput,
    IReceivePurchaseOrderPayload,
    IUpdatePurchaseOrderPayload,
} from "./purchase-order.interface";

const PURCHASE_ORDER_INCLUDE = {
    supplier: true,
    items: {
        include: {
            product: { select: { id: true, name: true, sku: true } },
            variant: { select: { id: true, name: true, sku: true } },
        },
    },
};

/**
 * Attaches `amountPaid`, `balanceDue` and `settlementState` to purchase order
 * rows on the way out.
 *
 * Computed rather than stored (design decision 11): a denormalized total is
 * what `Product.stockQuantity` vs `Stock.quantity` already looks like a year
 * later, and payments against one purchase order number in the ones, so this
 * is a `groupBy` over an indexed column rather than a consistency risk.
 */
const withSettlement = async <T extends { id: string; totalAmount: unknown }>(rows: T[]) => {
    const paidByPurchaseOrder = await sumPaymentsByPurchaseOrder(rows.map((row) => row.id));

    return rows.map((row) => ({
        ...row,
        ...deriveSettlement(Number(row.totalAmount), paidByPurchaseOrder.get(row.id) ?? 0),
    }));
};

const generatePurchaseNumber = () => {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `PO-${datePart}-${randomPart}`;
};

const generateUniquePurchaseNumber = async (): Promise<string> => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidate = generatePurchaseNumber();
        const existing = await prisma.purchaseOrder.findUnique({
            where: { purchaseNumber: candidate },
            select: { id: true },
        });
        if (!existing) {
            return candidate;
        }
    }
    throw new AppError(status.INTERNAL_SERVER_ERROR, "Failed to generate a unique purchase number");
};

const assertSupplierExists = async (supplierId: string) => {
    const supplier = await prisma.supplier.findUnique({
        where: { id: supplierId },
        select: { id: true },
    });

    if (!supplier) {
        throw new AppError(status.BAD_REQUEST, "Supplier not found");
    }
};

/**
 * A line may name a variant, but only one belonging to the same product —
 * otherwise the receipt would create stock under a variant that product does
 * not own, which customer orders could never match.
 */
const assertVariantsBelongToProducts = async (items: IPurchaseOrderItemInput[]) => {
    for (const item of items) {
        if (!item.variantId) continue;

        const variant = await prisma.productVariant.findUnique({
            where: { id: item.variantId },
            select: { productId: true },
        });

        if (!variant || variant.productId !== item.productId) {
            throw new AppError(status.BAD_REQUEST, "Variant does not belong to this product");
        }
    }
};

const createPurchaseOrder = async (userId: string, payload: ICreatePurchaseOrderPayload) => {
    await assertSupplierExists(payload.supplierId);
    await assertVariantsBelongToProducts(payload.items);

    const subtotal = payload.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
    const shippingCost = payload.shippingCost ?? 0;
    const taxAmount = payload.taxAmount ?? 0;
    const totalAmount = subtotal + shippingCost + taxAmount;

    const purchaseNumber = await generateUniquePurchaseNumber();

    const purchaseOrder = await prisma.purchaseOrder.create({
        data: {
            purchaseNumber,
            supplierId: payload.supplierId,
            subtotal,
            shippingCost,
            taxAmount,
            totalAmount,
            notes: payload.notes,
            orderedAt: payload.orderedAt ? new Date(payload.orderedAt) : undefined,
            items: {
                create: payload.items.map((item) => ({
                    productId: item.productId,
                    variantId: item.variantId ?? null,
                    quantity: item.quantity,
                    unitCost: item.unitCost,
                    totalCost: item.quantity * item.unitCost,
                })),
            },
        },
        include: PURCHASE_ORDER_INCLUDE,
    });

    await AuditLogService.record(userId, AuditAction.CREATE, "PurchaseOrder", purchaseOrder.id, {
        newData: purchaseOrder,
    });

    return purchaseOrder;
};

/**
 * Ids of purchase orders that still owe money, for the list's "balance owing"
 * filter.
 *
 * Raw SQL because the predicate compares a column against an aggregate over
 * another table, which neither Prisma's `where` nor `QueryBuilder` can express
 * — the same limitation analytics.service.ts already works around for low
 * stock. `QueryBuilder.where()` then merges the id set into both the page query
 * and its count, so paging stays correct.
 *
 * Returns an id list rather than a join because QueryBuilder owns the query.
 * That is fine at this table's scale (purchase orders number in the thousands,
 * not the millions); the Purchases report does the same comparison as a proper
 * join because it is not routed through QueryBuilder.
 */
const findPurchaseOrderIdsWithBalance = async () => {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT po."id"
        FROM "PurchaseOrder" po
        LEFT JOIN (
            SELECT "purchaseOrderId", SUM("amount") AS paid
            FROM "SupplierPayment"
            GROUP BY "purchaseOrderId"
        ) sp ON sp."purchaseOrderId" = po."id"
        WHERE po."totalAmount" - COALESCE(sp.paid, 0) > 0
    `;

    return rows.map((row) => row.id);
};

const getPurchaseOrders = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.purchaseOrder, queryParams, {
        searchableFields: ["purchaseNumber"],
        filterableFields: ["status", "supplierId"],
    });

    queryBuilder.search().filter().sort().paginate().include(PURCHASE_ORDER_INCLUDE);

    // Not a `filterableFields` entry: QueryBuilder drops any param outside that
    // allow-list silently, and it could not express this predicate anyway.
    if (String(queryParams.hasBalance) === "true") {
        queryBuilder.where({ id: { in: await findPurchaseOrderIdsWithBalance() } } as never);
    }

    const result = await queryBuilder.execute();

    return { ...result, data: await withSettlement(result.data as { id: string; totalAmount: unknown }[]) };
};

const getPurchaseOrderOrThrow = async (id: string) => {
    const purchaseOrder = await prisma.purchaseOrder.findUnique({
        where: { id },
        include: PURCHASE_ORDER_INCLUDE,
    });

    if (!purchaseOrder) {
        throw new AppError(status.NOT_FOUND, "Purchase order not found");
    }

    return purchaseOrder;
};

/** The detail read. Separate from `getPurchaseOrderOrThrow` so the internal guard callers above do not pay for a settlement query they ignore. */
const getPurchaseOrderById = async (id: string) => {
    const purchaseOrder = await getPurchaseOrderOrThrow(id);
    const [withFigures] = await withSettlement([purchaseOrder]);
    return withFigures;
};

/**
 * Refuses to strand recorded money on a document that no longer means
 * anything (`inventory/supplier-payments`). Applied to both cancellation and
 * deletion: `SupplierPayment.purchaseOrderId` cascades, so a delete would
 * destroy the payment rows silently, which is the same hazard with no trace.
 */
const assertNoSupplierPayments = async (id: string, action: "cancel" | "delete") => {
    const paymentCount = await prisma.supplierPayment.count({ where: { purchaseOrderId: id } });

    if (paymentCount > 0) {
        throw new AppError(
            status.CONFLICT,
            `Cannot ${action} a purchase order with ${paymentCount} recorded supplier payment${paymentCount === 1 ? "" : "s"}. Remove the payment${paymentCount === 1 ? "" : "s"} first.`,
        );
    }
};

const updatePurchaseOrder = async (userId: string, id: string, payload: IUpdatePurchaseOrderPayload) => {
    const existing = await getPurchaseOrderOrThrow(id);

    if (
        existing.status === PurchaseOrderStatus.RECEIVED ||
        existing.status === PurchaseOrderStatus.PARTIALLY_RECEIVED
    ) {
        throw new AppError(
            status.BAD_REQUEST,
            "Cannot edit a purchase order that has already started receiving stock",
        );
    }

    if (
        payload.status === PurchaseOrderStatus.CANCELLED &&
        existing.status !== PurchaseOrderStatus.CANCELLED
    ) {
        await assertNoSupplierPayments(id, "cancel");
    }

    const shippingCost = payload.shippingCost ?? Number(existing.shippingCost);
    const taxAmount = payload.taxAmount ?? Number(existing.taxAmount);
    const totalAmount = Number(existing.subtotal) + shippingCost + taxAmount;

    const updated = await prisma.purchaseOrder.update({
        where: { id },
        data: {
            shippingCost,
            taxAmount,
            totalAmount,
            notes: payload.notes,
            orderedAt: payload.orderedAt ? new Date(payload.orderedAt) : undefined,
            status: payload.status,
        },
        include: PURCHASE_ORDER_INCLUDE,
    });

    await AuditLogService.record(userId, AuditAction.UPDATE, "PurchaseOrder", id, {
        oldData: existing,
        newData: updated,
    });

    return updated;
};

/**
 * Amends what a purchase order still has outstanding.
 *
 * `updatePurchaseOrder` refuses all editing from the first receipt, and line
 * items were never in its payload at all — so a wrong quantity discovered
 * mid-delivery had no correction, and the only route was a second purchase
 * order that double-counts the commitment to the supplier. Worse, the frozen
 * `totalAmount` is what `assertPayable` compares supplier payments against, so
 * an understated order permanently capped what could be recorded as paid.
 *
 * What stays immutable is what has already ARRIVED. A receipt moved real stock
 * and set a cost basis from what was actually charged; rewriting it would make
 * the ledger disagree with the goods on the shelf. So a line may be amended
 * down to — never below — its `receivedQuantity`, and only a line that has
 * received nothing may be removed.
 *
 * The whole amendment is one transaction against a re-read of the order: a
 * receipt landing between the check and the write would otherwise let an
 * amendment computed against stale quantities overwrite it.
 */
const amendPurchaseOrderItems = async (
    userId: string,
    id: string,
    payload: IAmendPurchaseOrderPayload,
) => {
    const existing = await getPurchaseOrderOrThrow(id);

    if (existing.status === PurchaseOrderStatus.CANCELLED) {
        throw new AppError(status.BAD_REQUEST, "Cannot amend a cancelled purchase order");
    }

    await assertVariantsBelongToProducts(payload.items);

    const amended = await prisma.$transaction(async (tx) => {
        // Re-read inside the transaction: `receivedQuantity` is what every
        // guard below turns on, and a concurrent receipt must not be amended
        // away by a request that was composed before it landed.
        const current = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: id } });
        const currentById = new Map(current.map((item) => [item.id, item]));

        const keptIds = new Set(
            payload.items.filter((item) => item.id).map((item) => item.id as string),
        );

        for (const item of current) {
            if (keptIds.has(item.id)) continue;

            if (item.receivedQuantity > 0) {
                throw new AppError(
                    status.BAD_REQUEST,
                    `Cannot remove a line that has already received stock — ${item.receivedQuantity} unit(s) have arrived against it`,
                );
            }

            await tx.purchaseOrderItem.delete({ where: { id: item.id } });
        }

        for (const item of payload.items) {
            if (!item.id) {
                await tx.purchaseOrderItem.create({
                    data: {
                        purchaseOrderId: id,
                        productId: item.productId,
                        variantId: item.variantId ?? null,
                        quantity: item.quantity,
                        unitCost: item.unitCost,
                        totalCost: item.quantity * item.unitCost,
                    },
                });
                continue;
            }

            const line = currentById.get(item.id);
            if (!line) {
                throw new AppError(
                    status.BAD_REQUEST,
                    `Purchase order item ${item.id} does not belong to this purchase order`,
                );
            }

            if (item.quantity < line.receivedQuantity) {
                throw new AppError(
                    status.BAD_REQUEST,
                    `Cannot reduce this line to ${item.quantity} — ${line.receivedQuantity} unit(s) have already been received against it`,
                );
            }

            await tx.purchaseOrderItem.update({
                where: { id: line.id },
                data: {
                    productId: item.productId,
                    variantId: item.variantId ?? null,
                    quantity: item.quantity,
                    unitCost: item.unitCost,
                    totalCost: item.quantity * item.unitCost,
                },
            });
        }

        const subtotal = payload.items.reduce(
            (sum, item) => sum + item.quantity * item.unitCost,
            0,
        );
        const totalAmount = subtotal + Number(existing.shippingCost) + Number(existing.taxAmount);

        /*
         * An order's total caps what may be recorded as paid against it
         * (`assertPayable`). Amending below money already handed over would
         * strand that payment on a document that no longer accounts for it —
         * the same hazard `assertNoSupplierPayments` guards on cancellation.
         */
        const paid = await tx.supplierPayment.aggregate({
            where: { purchaseOrderId: id },
            _sum: { amount: true },
        });
        const alreadyPaid = Number(paid._sum.amount ?? 0);

        if (Math.round(totalAmount * 100) < Math.round(alreadyPaid * 100)) {
            throw new AppError(
                status.BAD_REQUEST,
                `This amendment would bring the order total to ${totalAmount}, below the ${alreadyPaid} already recorded as paid to the supplier`,
            );
        }

        // Receipts may now cover every remaining line, or no longer do — the
        // status is a consequence of the quantities, so it is recomputed rather
        // than left describing the order as it was before the amendment.
        const refreshed = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: id } });
        const fullyReceived =
            refreshed.length > 0 && refreshed.every((item) => item.receivedQuantity >= item.quantity);
        const anyReceived = refreshed.some((item) => item.receivedQuantity > 0);

        return tx.purchaseOrder.update({
            where: { id },
            data: {
                subtotal,
                totalAmount,
                status: fullyReceived
                    ? PurchaseOrderStatus.RECEIVED
                    : anyReceived
                      ? PurchaseOrderStatus.PARTIALLY_RECEIVED
                      : existing.status,
                receivedAt: fullyReceived ? (existing.receivedAt ?? new Date()) : null,
            },
            include: PURCHASE_ORDER_INCLUDE,
        });
    });

    await AuditLogService.record(userId, AuditAction.UPDATE, "PurchaseOrder", id, {
        oldData: existing,
        newData: amended,
    });

    return amended;
};

const deletePurchaseOrder = async (userId: string, id: string) => {
    const existing = await getPurchaseOrderOrThrow(id);

    if (
        existing.status === PurchaseOrderStatus.RECEIVED ||
        existing.status === PurchaseOrderStatus.PARTIALLY_RECEIVED
    ) {
        throw new AppError(
            status.CONFLICT,
            "Cannot delete a purchase order that has already received stock",
        );
    }

    await assertNoSupplierPayments(id, "delete");

    const deleted = await prisma.purchaseOrder.delete({ where: { id } });

    await AuditLogService.record(userId, AuditAction.DELETE, "PurchaseOrder", id, { oldData: existing });

    return deleted;
};

/**
 * Receives some or all of a purchase order's ordered quantities: bumps each
 * `PurchaseOrderItem.receivedQuantity`, increases `Stock.quantity` at
 * `payload.warehouseId` (upserting the `Stock` row if this is the first
 * receipt there), and writes a `StockMovement` (type PURCHASE) for every
 * item received — per `api/inventory` spec. Supports partial receipt: any
 * item may receive less than its remaining ordered quantity, and the
 * purchase order's status reflects whether everything has now been
 * received (RECEIVED) or only some of it has (PARTIALLY_RECEIVED).
 *
 * A receipt also moves the received item's COST BASIS
 * (`Product.purchasePrice` / `ProductVariant.purchasePrice`) to a moving
 * weighted average over the landed cost of what arrived — see
 * purchase-order.cost.ts. That is what stops the catalogue's cost from being
 * whatever a merchant typed on the day the product was created while
 * `PurchaseOrderItem.unitCost` records what suppliers have charged since.
 */
const receivePurchaseOrder = async (
    userId: string,
    id: string,
    payload: IReceivePurchaseOrderPayload,
) => {
    const purchaseOrder = await getPurchaseOrderOrThrow(id);

    if (purchaseOrder.status === PurchaseOrderStatus.CANCELLED) {
        throw new AppError(status.BAD_REQUEST, "Cannot receive a cancelled purchase order");
    }
    if (purchaseOrder.status === PurchaseOrderStatus.RECEIVED) {
        throw new AppError(status.BAD_REQUEST, "This purchase order has already been fully received");
    }

    const itemsById = new Map(purchaseOrder.items.map((item) => [item.id, item]));

    for (const receipt of payload.items) {
        const item = itemsById.get(receipt.purchaseOrderItemId);
        if (!item) {
            throw new AppError(
                status.BAD_REQUEST,
                `Purchase order item ${receipt.purchaseOrderItemId} does not belong to this purchase order`,
            );
        }

        const remaining = item.quantity - item.receivedQuantity;
        if (receipt.quantity > remaining) {
            throw new AppError(
                status.BAD_REQUEST,
                `Cannot receive ${receipt.quantity} of "${item.product.name}" — only ${remaining} remain unreceived`,
            );
        }
    }

    /*
     * Landed cost per unit for every line on the order, computed once up front
     * from the ORDERED quantities — shipping and tax were charged against the
     * whole order, so a line's landed unit cost is a property of the order, not
     * of how much of it happens to arrive in this receipt. A partial receipt
     * therefore brings in fewer units at the same per-unit cost.
     */
    const landedUnitCostByLine = allocateLandedUnitCosts({
        items: purchaseOrder.items.map((item) => ({
            id: item.id,
            quantity: item.quantity,
            unitCost: Number(item.unitCost),
        })),
        shippingCost: Number(purchaseOrder.shippingCost),
        taxAmount: Number(purchaseOrder.taxAmount),
    });

    /** Collected in the transaction, read after it commits to decide who to warn. */
    const costOutcomes: {
        productName: string;
        newCost: number;
        effectiveOfferPrice: number;
    }[] = [];

    await prisma.$transaction(async (tx) => {
        for (const receipt of payload.items) {
            const item = itemsById.get(receipt.purchaseOrderItemId)!;

            /*
             * Read BEFORE the stock increase below. Reading `stockQuantity`
             * after `applyDenormalizedStockDelta` has run would put the
             * received units in the average's denominator but not its
             * numerator, quietly under-weighting the new cost.
             *
             * The product row is loaded even for a variant line: a variant with
             * no price of its own is priced by its parent (see
             * productVariant.prisma), so both the cost basis it averages
             * against and the offer price it is compared to may live there.
             * Same COALESCE semantics report.stock.ts already values stock by.
             */
            const product = await tx.product.findUnique({
                where: { id: item.productId },
                select: { stockQuantity: true, purchasePrice: true, offerPrice: true },
            });

            const variant = item.variantId
                ? await tx.productVariant.findUnique({
                      where: { id: item.variantId },
                      select: { stockQuantity: true, purchasePrice: true, offerPrice: true },
                  })
                : null;

            const onHandBefore = variant
                ? variant.stockQuantity
                : (product?.stockQuantity ?? 0);

            const existingCostRaw = variant
                ? (variant.purchasePrice ?? product?.purchasePrice)
                : product?.purchasePrice;
            const existingCost = existingCostRaw == null ? null : Number(existingCostRaw);

            await tx.purchaseOrderItem.update({
                where: { id: item.id },
                data: { receivedQuantity: { increment: receipt.quantity } },
            });

            // Not a compound-unique upsert: Postgres treats NULL as distinct
            // in unique indexes, so `variantId: null` can't be used in the
            // `where` of `Stock`'s `@@unique([warehouseId, productId,
            // variantId])` (same gotcha CartItem.prisma documents) — an
            // explicit find-or-create is used instead.
            // Stock is held per (warehouse, product, variant). Receiving against
            // the line's own variant is what lets a customer order — which
            // deducts by the variant bought — actually find this stock.
            const existingStock = await tx.stock.findFirst({
                where: {
                    warehouseId: payload.warehouseId,
                    productId: item.productId,
                    variantId: item.variantId,
                },
            });

            if (existingStock) {
                await tx.stock.update({
                    where: { id: existingStock.id },
                    data: { quantity: { increment: receipt.quantity } },
                });
            } else {
                await tx.stock.create({
                    data: {
                        warehouseId: payload.warehouseId,
                        productId: item.productId,
                        variantId: item.variantId,
                        quantity: receipt.quantity,
                    },
                });
            }

            await tx.stockMovement.create({
                data: {
                    productId: item.productId,
                    variantId: item.variantId,
                    warehouseId: payload.warehouseId,
                    type: StockMovementType.PURCHASE,
                    quantity: receipt.quantity,
                    referenceId: purchaseOrder.id,
                    note: `Received against purchase order ${purchaseOrder.purchaseNumber}`,
                },
            });

            // Keep Product.stockQuantity (and the variant's, when the line names
            // one) in sync with the ledger.
            await StockService.applyDenormalizedStockDelta(
                tx,
                item.productId,
                item.variantId,
                receipt.quantity,
            );

            /*
             * Move the cost basis, in the same transaction as the stock it
             * describes — a receipt must never leave units on hand recorded at
             * a cost the ledger did not also record.
             *
             * The write is variant-scoped when the line is: that is the stock
             * this delivery actually replenished, and the parent product's own
             * basis says nothing about it.
             */
            const landedUnitCost = landedUnitCostByLine.get(item.id);

            if (landedUnitCost !== undefined) {
                const newCost = weightedAverageCost(
                    onHandBefore,
                    existingCost,
                    receipt.quantity,
                    landedUnitCost,
                );

                if (variant) {
                    await tx.productVariant.update({
                        where: { id: item.variantId as string },
                        data: { purchasePrice: newCost },
                    });
                } else {
                    await tx.product.update({
                        where: { id: item.productId },
                        data: { purchasePrice: newCost },
                    });
                }

                const effectiveOfferPrice = Number(variant?.offerPrice ?? product?.offerPrice ?? 0);

                costOutcomes.push({
                    productName: item.variant
                        ? `${item.product.name} — ${item.variant.name}`
                        : item.product.name,
                    newCost,
                    effectiveOfferPrice,
                });
            }
        }

        const refreshedItems = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: id } });
        const fullyReceived = refreshedItems.every((item) => item.receivedQuantity >= item.quantity);
        const anyReceived = refreshedItems.some((item) => item.receivedQuantity > 0);

        await tx.purchaseOrder.update({
            where: { id },
            data: {
                status: fullyReceived
                    ? PurchaseOrderStatus.RECEIVED
                    : anyReceived
                      ? PurchaseOrderStatus.PARTIALLY_RECEIVED
                      : purchaseOrder.status,
                receivedAt: fullyReceived ? new Date() : purchaseOrder.receivedAt,
            },
        });
    });

    const received = await getPurchaseOrderOrThrow(id);

    await AuditLogService.record(userId, AuditAction.UPDATE, "PurchaseOrder", id, {
        oldData: purchaseOrder,
        newData: received,
    });

    for (const receipt of payload.items) {
        const item = itemsById.get(receipt.purchaseOrderItemId)!;
        await StockService.notifyIfLowStock(item.productId, null, item.product.name);
    }

    /*
     * A receipt that prices an item at or above what it sells for is NOT an
     * error and must not have failed the transaction above — the goods have
     * arrived, and refusing to record them to protect a price that is merely
     * now unprofitable would leave the stock ledger wrong about the physical
     * world. The catalogue's `offerPrice > purchasePrice` rule constrains what
     * a merchant may author on the product form; it says nothing about what a
     * supplier is allowed to charge.
     *
     * So it is reported instead, the way low stock already is, and the merchant
     * corrects the price deliberately.
     */
    for (const outcome of costOutcomes) {
        if (outcome.effectiveOfferPrice > 0 && outcome.newCost >= outcome.effectiveOfferPrice) {
            await NotificationService.notifyOwnersAndAdmins(
                NotificationType.INVENTORY,
                "Selling below cost",
                `"${outcome.productName}" now costs ${outcome.newCost} after this receipt but sells for ${outcome.effectiveOfferPrice}. Raise the offer price or this product loses money on every sale.`,
            );
        }
    }

    return received;
};

export const PurchaseOrderService = {
    createPurchaseOrder,
    getPurchaseOrders,
    getPurchaseOrderById,
    getPurchaseOrderOrThrow,
    updatePurchaseOrder,
    amendPurchaseOrderItems,
    deletePurchaseOrder,
    receivePurchaseOrder,
};
