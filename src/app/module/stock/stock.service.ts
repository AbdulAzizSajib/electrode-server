import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { AuditAction, NotificationType, Prisma, StockMovementType } from "../../../generated/prisma/client";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { AuditLogService } from "../audit-log/audit-log.service";
import { NotificationService } from "../notification/notification.service";
import { IAdjustStockPayload, ILowStockCheckResult, IReassignStockPayload } from "./stock.interface";

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
    }

    /*
     * The product total is incremented either way — including for a
     * variant-scoped movement, which also belongs to the product that owns the
     * variant. It is the sum of everything held for the product, so a variable
     * product's total is the sum across its variants.
     *
     * Previously this was an either/or, leaving `Product.stockQuantity` at 0
     * forever for a variable product. That was invisible only because product
     * create let a merchant type a number straight into the column; with the
     * ledger as the sole writer, an unmaintained total would read 0 and the
     * storefront — which derives `inStock` from it — would call every variable
     * product out of stock. See remove-catalog-authored-stock design.md.
     */
    await tx.product.update({
        where: { id: productId },
        data: { stockQuantity: { increment: delta } },
    });
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

/**
 * Moves quantity from one stock row onto the same product's variant-scoped row,
 * correcting stock that was received against the wrong variant — or against no
 * variant at all.
 *
 * This exists because that mistake is otherwise unrecoverable from the admin.
 * Stock is held per (warehouse, product, variant) and orders deduct against the
 * variant bought, so units sitting on a `variantId: null` row of a variable
 * product can never be sold: the product reads out of stock however much
 * arrived, and `adjustStock` can only change a row's quantity, never which
 * variant it belongs to. Removing the stock and re-receiving it is not an
 * answer either — that rewrites the cost basis a receipt established.
 *
 * Not modelled as two adjustments. An ADJUSTMENT means the quantity on hand
 * changed; nothing changed here except which variant the same physical units
 * are filed under, and recording a -50/+50 pair would misreport a correction as
 * a loss and a gain in the stock history. TRANSFER_OUT/TRANSFER_IN say exactly
 * that the same units moved, and the pair shares a `referenceId` so the two
 * halves can be read back as one correction.
 *
 * The whole move is one transaction: a half-applied reassignment would either
 * destroy stock or invent it.
 */
const reassignStockVariant = async (
    userId: string,
    stockId: string,
    payload: IReassignStockPayload,
) => {
    const source = await prisma.stock.findUnique({
        where: { id: stockId },
        include: { product: { select: { name: true } } },
    });

    if (!source) {
        throw new AppError(status.NOT_FOUND, "Stock record not found");
    }

    if (source.variantId === payload.variantId) {
        throw new AppError(status.BAD_REQUEST, "This stock is already assigned to that variant");
    }

    const variant = await prisma.productVariant.findUnique({
        where: { id: payload.variantId },
        select: { id: true, productId: true, name: true },
    });

    // Guarded rather than assumed: a variant of some other product would create
    // stock the owning product never received, which is the same class of
    // silent corruption this endpoint exists to undo.
    if (!variant || variant.productId !== source.productId) {
        throw new AppError(status.BAD_REQUEST, "Variant does not belong to this product");
    }

    /*
     * Reserved units back a customer order that has already been placed against
     * this row. Moving them would leave that order pointing at stock the row no
     * longer has, so only what is genuinely unspoken-for can move.
     */
    const movable = source.quantity - source.reservedQuantity;
    if (payload.quantity > movable) {
        throw new AppError(
            status.BAD_REQUEST,
            `Cannot move ${payload.quantity} — this row holds ${source.quantity} with ${source.reservedQuantity} reserved, so only ${movable} can be reassigned`,
        );
    }

    const note =
        payload.note ??
        `Reassigned to variant "${variant.name}" — stock had been received against ${source.variantId ? "the wrong variant" : "no variant"}`;

    const result = await prisma.$transaction(async (tx) => {
        await tx.stock.update({
            where: { id: source.id },
            data: { quantity: { decrement: payload.quantity } },
        });

        // Same find-or-create as purchase-order receiving, and for the same
        // reason: Postgres treats NULL as distinct in a unique index, so the
        // compound unique cannot be used in an upsert `where` here.
        const destination = await tx.stock.findFirst({
            where: {
                warehouseId: source.warehouseId,
                productId: source.productId,
                variantId: payload.variantId,
            },
        });

        const updatedDestination = destination
            ? await tx.stock.update({
                  where: { id: destination.id },
                  data: { quantity: { increment: payload.quantity } },
                  include: STOCK_INCLUDE,
              })
            : await tx.stock.create({
                  data: {
                      warehouseId: source.warehouseId,
                      productId: source.productId,
                      variantId: payload.variantId,
                      quantity: payload.quantity,
                  },
                  include: STOCK_INCLUDE,
              });

        await tx.stockMovement.createMany({
            data: [
                {
                    productId: source.productId,
                    variantId: source.variantId,
                    warehouseId: source.warehouseId,
                    type: StockMovementType.TRANSFER_OUT,
                    quantity: payload.quantity,
                    referenceId: source.id,
                    note,
                },
                {
                    productId: source.productId,
                    variantId: payload.variantId,
                    warehouseId: source.warehouseId,
                    type: StockMovementType.TRANSFER_IN,
                    quantity: payload.quantity,
                    referenceId: source.id,
                    note,
                },
            ],
        });

        /*
         * Only the variant mirrors move. `Product.stockQuantity` is the sum
         * across the product's variants and the units never left the product,
         * so passing this through `applyDenormalizedStockDelta` — which credits
         * the product on every call — would double-count the move as a gain.
         */
        if (source.variantId) {
            await tx.productVariant.update({
                where: { id: source.variantId },
                data: { stockQuantity: { decrement: payload.quantity } },
            });
        }

        await tx.productVariant.update({
            where: { id: payload.variantId },
            data: { stockQuantity: { increment: payload.quantity } },
        });

        return updatedDestination;
    });

    await AuditLogService.record(userId, AuditAction.UPDATE, "Stock", source.id, {
        oldData: source,
        newData: result,
    });

    return result;
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
    reassignStockVariant,
    getStockMovements,
    applyDenormalizedStockDelta,
    checkLowStock,
    notifyIfLowStock,
};
