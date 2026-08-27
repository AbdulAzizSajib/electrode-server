import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { AuditAction, PurchaseOrderStatus, StockMovementType } from "../../../generated/prisma/client";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { AuditLogService } from "../audit-log/audit-log.service";
import { StockService } from "../stock/stock.service";
import {
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

const getPurchaseOrders = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.purchaseOrder, queryParams, {
        searchableFields: ["purchaseNumber"],
        filterableFields: ["status", "supplierId"],
    });

    return queryBuilder
        .search()
        .filter()
        .sort()
        .paginate()
        .include(PURCHASE_ORDER_INCLUDE)
        .execute();
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

    await prisma.$transaction(async (tx) => {
        for (const receipt of payload.items) {
            const item = itemsById.get(receipt.purchaseOrderItemId)!;

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

    return received;
};

export const PurchaseOrderService = {
    createPurchaseOrder,
    getPurchaseOrders,
    getPurchaseOrderOrThrow,
    updatePurchaseOrder,
    deletePurchaseOrder,
    receivePurchaseOrder,
};
