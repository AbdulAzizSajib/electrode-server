import status from "http-status";
import { RoleName } from "../../constants/role.constant";
import AppError from "../../errorHelpers/AppError";
import { NotificationType, OrderStatus, Prisma, ProductStatus, StockMovementType } from "../../../generated/prisma/client";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { CouponService } from "../coupon/coupon.service";
import { CustomerService } from "../customer/customer.service";
import { NotificationService } from "../notification/notification.service";
import { StockService } from "../stock/stock.service";
import { StoreSettingService } from "../store-setting/store-setting.service";
import { ICreateOrderPayload, IOrderItemData, IUpdateOrderStatusPayload } from "./order.interface";

const ORDER_DETAIL_INCLUDE = {
    items: true,
    payments: true,
    shipments: { include: { shippingMethod: true } },
    statusHistory: { orderBy: { createdAt: "desc" as const } },
    shippingAddress: true,
    customer: {
        select: { id: true, firstName: true, lastName: true, email: true, phone: true },
    },
};

const ORDER_LIST_INCLUDE = {
    customer: { select: { id: true, firstName: true, lastName: true } },
};

const isStaffRole = (role: RoleName) =>
    role === RoleName.OWNER || role === RoleName.ADMIN || role === RoleName.STAFF;

const generateOrderNumber = () => {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `ORD-${datePart}-${randomPart}`;
};

const generateUniqueOrderNumber = async (): Promise<string> => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidate = generateOrderNumber();
        const existing = await prisma.order.findUnique({
            where: { orderNumber: candidate },
            select: { id: true },
        });
        if (!existing) {
            return candidate;
        }
    }
    throw new AppError(status.INTERNAL_SERVER_ERROR, "Failed to generate a unique order number");
};

/**
 * Deducts `quantity` for one order line from the warehouse-scoped `Stock`
 * ledger, largest-available-quantity warehouse first, splitting across
 * warehouses when one alone doesn't cover it (per `api/checkout` spec's
 * "Checkout validates stock and price..." requirement). Writes one
 * `StockMovement` (`type: SALE`, negative `quantity`) per contributing
 * warehouse, then applies the same total delta to the denormalized
 * `Product`/`ProductVariant.stockQuantity` (kept in sync by this same
 * mechanism on the receiving end — see `api/inventory` spec). Re-reads
 * `Stock` inside the transaction rather than trusting the pre-transaction
 * availability check, so a concurrent order can't double-spend the same
 * stock; throws (aborting the transaction) if that re-check comes up short.
 */
const deductStockForOrderItem = async (
    tx: Prisma.TransactionClient,
    orderId: string,
    productId: string,
    variantId: string | null,
    quantity: number,
    productName: string,
) => {
    const stockRows = await tx.stock.findMany({
        where: { productId, variantId },
        orderBy: { quantity: "desc" },
    });

    let remaining = quantity;

    for (const row of stockRows) {
        if (remaining <= 0) break;

        const available = row.quantity - row.reservedQuantity;
        if (available <= 0) continue;

        const take = Math.min(available, remaining);

        await tx.stock.update({ where: { id: row.id }, data: { quantity: { decrement: take } } });
        await tx.stockMovement.create({
            data: {
                productId,
                variantId,
                warehouseId: row.warehouseId,
                type: StockMovementType.SALE,
                quantity: -take,
                referenceId: orderId,
            },
        });

        remaining -= take;
    }

    if (remaining > 0) {
        throw new AppError(
            status.CONFLICT,
            `Insufficient stock for "${productName}" — stock changed since checkout started`,
        );
    }

    await StockService.applyDenormalizedStockDelta(tx, productId, variantId, -quantity);
};

/**
 * Checkout: snapshots the customer's cart into an immutable Order, per
 * `api/checkout` spec.
 */
const placeOrder = async (userId: string, payload: ICreateOrderPayload) => {
    const customer = await CustomerService.getOrCreateCustomerByUserId(userId);

    const cart = await prisma.cart.findUnique({
        where: { customerId: customer.id },
        include: { items: { include: { product: true, variant: true } } },
    });

    if (!cart || cart.items.length === 0) {
        throw new AppError(status.BAD_REQUEST, "Your cart is empty");
    }

    if (payload.shippingAddressId) {
        const address = await prisma.customerAddress.findUnique({
            where: { id: payload.shippingAddressId },
        });
        if (!address || address.customerId !== customer.id) {
            throw new AppError(status.BAD_REQUEST, "Shipping address not found");
        }
    }

    const shippingMethod = payload.shippingMethodId
        ? await prisma.shippingMethod.findUnique({ where: { id: payload.shippingMethodId } })
        : null;

    if (payload.shippingMethodId && (!shippingMethod || !shippingMethod.isActive)) {
        throw new AppError(status.BAD_REQUEST, "Shipping method not found");
    }

    const orderItemsData: IOrderItemData[] = [];
    let subtotal = 0;

    for (const item of cart.items) {
        if (item.product.status !== ProductStatus.ACTIVE) {
            throw new AppError(status.CONFLICT, `"${item.product.name}" is no longer available`);
        }

        // Summed across every warehouse's Stock.quantity - Stock.reservedQuantity, not the
        // denormalized total alone — see deductStockForOrderItem above for the actual deduction.
        const stockAggregate = await prisma.stock.aggregate({
            where: { productId: item.productId, variantId: item.variantId ?? null },
            _sum: { quantity: true, reservedQuantity: true },
        });
        const availableStock =
            (stockAggregate._sum.quantity ?? 0) - (stockAggregate._sum.reservedQuantity ?? 0);

        if (item.quantity > availableStock) {
            throw new AppError(
                status.CONFLICT,
                `Insufficient stock for "${item.product.name}" — requested ${item.quantity}, available ${availableStock}`,
            );
        }

        const unitPrice = Number(item.variant?.price ?? item.product.price);
        const totalPrice = unitPrice * item.quantity;
        subtotal += totalPrice;

        orderItemsData.push({
            productId: item.productId,
            variantId: item.variantId,
            productName: item.product.name,
            sku: item.variant?.sku ?? item.product.sku,
            quantity: item.quantity,
            unitPrice,
            totalPrice,
        });
    }

    // Coupon (Phase 6): re-validates whatever coupon is applied to the cart
    // (see coupon.constant.ts) against these same cart items, one last time,
    // right before the order is committed.
    const appliedCoupon = payload.couponCode
        ? await CouponService.getActiveCouponByCode(payload.couponCode)
        : null;
    const couponResult = appliedCoupon
        ? await CouponService.validateCouponForCart(appliedCoupon, cart.items, customer.id)
        : null;
    const discountAmount = couponResult?.discountAmount ?? 0;

    // Tax/free-shipping (Phase "close-core-api-gaps"): StoreSetting.defaultTaxRatePercent
    // and .freeShippingThreshold were settable but never read before this.
    const storeSetting = await StoreSettingService.getStoreSetting();

    const shippingAmountBeforeCoupon = shippingMethod ? Number(shippingMethod.price) : 0;
    const meetsFreeShippingThreshold =
        storeSetting.freeShippingThreshold !== null &&
        subtotal >= Number(storeSetting.freeShippingThreshold);
    const shippingAmount =
        couponResult?.freeShipping || meetsFreeShippingThreshold ? 0 : shippingAmountBeforeCoupon;

    // Tax on the post-discount subtotal — see design.md's "Tax is computed on the post-discount subtotal".
    const taxAmount = ((subtotal - discountAmount) * Number(storeSetting.defaultTaxRatePercent)) / 100;

    const totalAmount = subtotal + shippingAmount + taxAmount - discountAmount;

    if (payload.expectedTotal !== undefined && Math.abs(payload.expectedTotal - totalAmount) > 0.01) {
        throw new AppError(
            status.CONFLICT,
            `Price mismatch — server computed ${totalAmount.toFixed(2)}, client expected ${payload.expectedTotal.toFixed(2)}`,
        );
    }

    const orderNumber = await generateUniqueOrderNumber();

    const created = await prisma.$transaction(async (tx) => {
        const order = await tx.order.create({
            data: {
                orderNumber,
                customerId: customer.id,
                subtotal,
                discountAmount,
                shippingAmount,
                taxAmount,
                totalAmount,
                couponCode: appliedCoupon?.code,
                notes: payload.notes,
                shippingAddressId: payload.shippingAddressId,
                items: { createMany: { data: orderItemsData } },
                statusHistory: { create: { toStatus: OrderStatus.PENDING } },
                ...(payload.shippingMethodId
                    ? { shipments: { create: { shippingMethodId: payload.shippingMethodId } } }
                    : {}),
            },
        });

        // Coupon redemption is recorded here, not before — it must only count once the order actually commits.
        if (appliedCoupon) {
            await tx.coupon.update({
                where: { id: appliedCoupon.id },
                data: { usageCount: { increment: 1 } },
            });
        }

        for (const item of cart.items) {
            await deductStockForOrderItem(
                tx,
                order.id,
                item.productId,
                item.variantId,
                item.quantity,
                item.product.name,
            );
        }

        // Clear the cart on success (the Cart row itself is kept for reuse).
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

        return tx.order.findUniqueOrThrow({
            where: { id: order.id },
            include: ORDER_DETAIL_INCLUDE,
        });
    });

    // Best-effort, outside the transaction (see StockService.notifyIfLowStock) — a checkout
    // that already committed must not fail just because the low-stock alert had trouble.
    for (const item of cart.items) {
        await StockService.notifyIfLowStock(item.productId, item.variantId, item.product.name);
    }

    return created;
};

const getOrders = async (userId: string, role: RoleName, queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.order, queryParams, {
        searchableFields: ["orderNumber"],
        filterableFields: ["status"],
    });

    queryBuilder.search().filter().sort().paginate().include(ORDER_LIST_INCLUDE);

    if (!isStaffRole(role)) {
        const customer = await CustomerService.getOrCreateCustomerByUserId(userId);
        queryBuilder.where({ customerId: customer.id });
    }

    return queryBuilder.execute();
};

const getOrderById = async (userId: string, role: RoleName, orderId: string) => {
    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: ORDER_DETAIL_INCLUDE,
    });

    if (!order) {
        throw new AppError(status.NOT_FOUND, "Order not found");
    }

    if (!isStaffRole(role)) {
        const customer = await CustomerService.getOrCreateCustomerByUserId(userId);
        if (order.customerId !== customer.id) {
            // 404, not 403 — avoids confirming the order's existence to a non-owner (per api/checkout spec).
            throw new AppError(status.NOT_FOUND, "Order not found");
        }
    }

    return order;
};

/** Order states from which a customer may still cancel their own order — before fulfillment has actually started. */
const CUSTOMER_CANCELLABLE_STATUSES: OrderStatus[] = [OrderStatus.PENDING, OrderStatus.CONFIRMED];

/**
 * Customer self-service cancellation — deliberately a separate endpoint from
 * the staff-only `updateOrderStatus` above (see design.md's "Self-cancel is
 * a separate endpoint" decision) rather than widening that one's role gate.
 */
const cancelOwnOrder = async (userId: string, orderId: string) => {
    const customer = await CustomerService.getOrCreateCustomerByUserId(userId);
    const order = await prisma.order.findUnique({ where: { id: orderId } });

    if (!order || order.customerId !== customer.id) {
        throw new AppError(status.NOT_FOUND, "Order not found");
    }

    if (!CUSTOMER_CANCELLABLE_STATUSES.includes(order.status)) {
        throw new AppError(
            status.BAD_REQUEST,
            `This order can no longer be cancelled (current status: ${order.status})`,
        );
    }

    const cancelled = await prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id: orderId }, data: { status: OrderStatus.CANCELLED } });

        await tx.orderStatusHistory.create({
            data: {
                orderId,
                fromStatus: order.status,
                toStatus: OrderStatus.CANCELLED,
                changedById: userId,
            },
        });

        return tx.order.findUniqueOrThrow({
            where: { id: orderId },
            include: ORDER_DETAIL_INCLUDE,
        });
    });

    await NotificationService.createNotification(
        userId,
        NotificationType.ORDER,
        "Order cancelled",
        `Your order ${cancelled.orderNumber} has been cancelled.`,
    );

    return cancelled;
};

const updateOrderStatus = async (
    orderId: string,
    payload: IUpdateOrderStatusPayload,
    changedByUserId: string,
) => {
    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { customer: { select: { userId: true } } },
    });

    if (!order) {
        throw new AppError(status.NOT_FOUND, "Order not found");
    }

    if (order.status === payload.status) {
        throw new AppError(status.BAD_REQUEST, `Order is already ${payload.status}`);
    }

    const updated = await prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id: orderId }, data: { status: payload.status } });

        await tx.orderStatusHistory.create({
            data: {
                orderId,
                fromStatus: order.status,
                toStatus: payload.status,
                note: payload.note,
                changedById: changedByUserId,
            },
        });

        return tx.order.findUniqueOrThrow({
            where: { id: orderId },
            include: ORDER_DETAIL_INCLUDE,
        });
    });

    // Customer.userId is nullable (SetNull if the underlying User is ever deleted) — no
    // recipient to notify in that edge case, so skip rather than notify a null userId.
    if (order.customer.userId) {
        await NotificationService.createNotification(
            order.customer.userId,
            NotificationType.ORDER,
            "Order status updated",
            `Your order ${updated.orderNumber} is now ${payload.status}.`,
        );
    }

    return updated;
};

export const OrderService = {
    placeOrder,
    getOrders,
    getOrderById,
    cancelOwnOrder,
    updateOrderStatus,
};
