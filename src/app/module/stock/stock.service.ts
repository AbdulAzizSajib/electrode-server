import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { AuditAction, NotificationType, Prisma, StockMovementType } from "../../../generated/prisma/client";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { AuditLogService } from "../audit-log/audit-log.service";
import { NotificationService } from "../notification/notification.service";
import { IAdjustStockPayload, ILowStockCheckResult } from "./stock.interface";

const STOCK_INCLUDE = {
    warehouse: { select: { id: true, name: true, code: true } },
    product: { select: { id: true, name: true, sku: true } },
    variant: { select: { id: true, name: true, sku: true } },
};

/**
 * Applies `delta` to whichever denormalized total a `Stock` row's
 * productId/variantId maps to — `ProductVariant.stockQuantity` when the
 * stock is variant-scoped, `Product.stockQuantity` otherwise. Keeps Phase
 * 1's public read paths accurate whenever a `StockMovement` changes the
 * warehouse-scoped ledger (adjustment or purchase-order receipt — see
 * `api/inventory` spec). Shared by stock adjustment, purchase-order
 * receiving, and checkout's stock deduction.
 */
const applyDenormalizedStockDelta = async (
    tx: Prisma.TransactionClient,
    productId: string,
    variantId: string | null,
    delta: number,
) => {
    if (variantId) {
        await tx.productVariant.update({
            where: { id: variantId },
            data: { stockQuantity: { increment: delta } },
        });
    } else {
        await tx.product.update({
            where: { id: productId },
            data: { stockQuantity: { increment: delta } },
        });
    }
};

/**
 * Sums `Stock.quantity` across every warehouse for a product/variant and
 * compares it to `Product.lowStockThreshold` (a product-level setting even
 * for variant-scoped stock — `ProductVariant` has no threshold of its own).
 * Pure check, no side effect — callers (stock adjust, purchase-order
 * receive, checkout) decide whether/how to notify on a low-stock result.
 */
const checkLowStock = async (
    productId: string,
    variantId: string | null,
): Promise<ILowStockCheckResult> => {
    const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { lowStockThreshold: true },
    });
    const lowStockThreshold = product?.lowStockThreshold ?? 0;

    const aggregate = await prisma.stock.aggregate({
        where: { productId, variantId },
        _sum: { quantity: true },
    });
    const availableQuantity = aggregate._sum.quantity ?? 0;

    return {
        isLowStock: availableQuantity <= lowStockThreshold,
        availableQuantity,
        lowStockThreshold,
    };
};

/**
 * Runs `checkLowStock` and, if it's crossed the threshold, notifies every
 * OWNER/ADMIN (`type: INVENTORY`) — per `api/inventory` spec. Shared by
 * stock adjustment, purchase-order receiving, and checkout's deduction
 * (task 6.6) so the three call sites don't each re-implement the notify step.
 */
const notifyIfLowStock = async (productId: string, variantId: string | null, productLabel: string) => {
    const result = await checkLowStock(productId, variantId);

    if (result.isLowStock) {
        await NotificationService.notifyOwnersAndAdmins(
            NotificationType.INVENTORY,
            "Low stock alert",
            `"${productLabel}" is low on stock: ${result.availableQuantity} remaining (threshold ${result.lowStockThreshold}).`,
        );
    }
};

const getStock = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.stock, queryParams, {
        filterableFields: ["warehouseId", "productId", "variantId"],
    });

    return queryBuilder.filter().sort().paginate().include(STOCK_INCLUDE).execute();
};

/**
 * Adjusts `Stock.quantity` by a signed delta and always writes a matching
 * `StockMovement` (type ADJUSTMENT) in the same transaction — per
 * `api/inventory` spec, `Stock` is never edited directly without an audit
 * trail entry.
 */
const adjustStock = async (userId: string, stockId: string, payload: IAdjustStockPayload) => {
    const stock = await prisma.stock.findUnique({ where: { id: stockId } });

    if (!stock) {
        throw new AppError(status.NOT_FOUND, "Stock record not found");
    }

    const newQuantity = stock.quantity + payload.quantityDelta;
    if (newQuantity < 0) {
        throw new AppError(
            status.BAD_REQUEST,
            `Adjustment would bring stock below zero (current ${stock.quantity}, delta ${payload.quantityDelta})`,
        );
    }

    const updated = await prisma.$transaction(async (tx) => {
        const updatedStock = await tx.stock.update({
            where: { id: stockId },
            data: { quantity: newQuantity },
            include: STOCK_INCLUDE,
        });

        await tx.stockMovement.create({
            data: {
                productId: stock.productId,
                variantId: stock.variantId,
                warehouseId: stock.warehouseId,
                type: StockMovementType.ADJUSTMENT,
                quantity: payload.quantityDelta,
                referenceId: stock.id,
                note: payload.note,
            },
        });

        await applyDenormalizedStockDelta(tx, stock.productId, stock.variantId, payload.quantityDelta);

        return updatedStock;
    });

    await AuditLogService.record(userId, AuditAction.UPDATE, "Stock", stockId, {
        oldData: stock,
        newData: updated,
    });

    await notifyIfLowStock(stock.productId, stock.variantId, updated.product.name);

    return updated;
};

const getStockMovements = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.stockMovement, queryParams, {
        filterableFields: ["productId", "variantId", "warehouseId", "type"],
    });

    return queryBuilder
        .filter()
        .sort()
        .paginate()
        .include({
            product: { select: { id: true, name: true, sku: true } },
            variant: { select: { id: true, name: true, sku: true } },
            warehouse: { select: { id: true, name: true, code: true } },
        })
        .execute();
};

export const StockService = {
    getStock,
    adjustStock,
    getStockMovements,
    applyDenormalizedStockDelta,
    checkLowStock,
    notifyIfLowStock,
};
