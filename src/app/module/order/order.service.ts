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

/**
 * Which unique constraint a P2002 actually violated. `Order` has two
 * (`orderNumber` and `idempotencyKey`) and both are retried differently —
 * a collision on the first means "generate another number and try again",
 * on the second it means "someone else already placed this exact order".
 * Treating them interchangeably would turn a replay into a new order, so
 * never catch P2002 without checking which target it names.
 */
const violatedTarget = (error: unknown, field: string) => {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        return false;
    }
    const target = error.meta?.target;
    return Array.isArray(target) ? target.includes(field) : target === field;
};

/**
 * The order a given idempotency key already produced, or null if the key is
 * unused. `idempotencyKey` is globally unique rather than unique-per-customer,
 * so ownership is enforced here instead: a key that resolves to someone else's
 * order returns null — the request proceeds as a fresh checkout rather than
 * disclosing, or handing back, an order belonging to another customer.
 */
const findReplayableOrder = async (idempotencyKey: string, customerId: string) => {
    const existing = await prisma.order.findUnique({
        where: { idempotencyKey },
        include: ORDER_DETAIL_INCLUDE,
    });

    if (!existing || existing.customerId !== customerId) {
        return null;
    }

    return existing;
};

/**
 * A replay is only meaningful if it's replaying the *same* order. When the
 * live cart no longer matches what the stored order captured, the client is
 * most likely reusing one key across genuinely different checkouts — which
 * silently returns the wrong order. Still safe (nothing is double-charged),
 * but it means the client is not getting the protection it thinks it is, so
 * make it visible rather than letting it pass unnoticed.
 */
const warnIfReplayDiverges = (
    idempotencyKey: string,
    storedItems: { productId: string; variantId: string | null; quantity: number }[],
    cartItems: { productId: string; variantId: string | null; quantity: number }[],
) => {
    const fingerprint = (items: { productId: string; variantId: string | null; quantity: number }[]) =>
        items
            .map((i) => `${i.productId}:${i.variantId ?? ""}:${i.quantity}`)
            .sort()
            .join("|");

    if (fingerprint(storedItems) !== fingerprint(cartItems)) {
        console.warn(
            `Idempotency key ${idempotencyKey} replayed against a cart that no longer matches the stored order — the client is likely reusing one key across different checkouts.`,
        );
    }
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

    // Replay check runs before the empty-cart guard below, and that ordering is
    // the whole fix: a retry of a checkout that already committed arrives at an
    // emptied cart, and must return the original order instead of "Your cart is
    // empty" — precisely the failure this change exists to eliminate.
    const [replayedOrder, cart] = await Promise.all([
        payload.idempotencyKey
            ? findReplayableOrder(payload.idempotencyKey, customer.id)
            : Promise.resolve(null),
        prisma.cart.findUnique({
            where: { customerId: customer.id },
            include: { items: { include: { product: true, variant: true } } },
        }),
    ]);

    if (replayedOrder) {
        warnIfReplayDiverges(
            payload.idempotencyKey as string,
            replayedOrder.items,
            cart?.items ?? [],
        );
        return { order: replayedOrder, isReplay: true };
    }

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

    // Availability for every cart line in one grouped query rather than one
    // aggregate per line. Still summed across every warehouse's
    // Stock.quantity - Stock.reservedQuantity, not the denormalized total —
    // see deductStockForOrderItem above for the actual deduction, which stays
    // per-item because each deduction depends on reading its own warehouse rows.
    const stockRows = await prisma.stock.groupBy({
        by: ["productId", "variantId"],
        where: { productId: { in: cart.items.map((item) => item.productId) } },
        _sum: { quantity: true, reservedQuantity: true },
    });

    const stockKey = (productId: string, variantId: string | null) =>
        `${productId}:${variantId ?? ""}`;

    const availableByKey = new Map(
        stockRows.map((row) => [
            stockKey(row.productId, row.variantId),
            (row._sum.quantity ?? 0) - (row._sum.reservedQuantity ?? 0),
        ]),
    );

    for (const item of cart.items) {
        if (item.product.status !== ProductStatus.ACTIVE) {
            throw new AppError(status.CONFLICT, `"${item.product.name}" is no longer available`);
        }

        // Absent from the map means no Stock row exists at all for this
        // product/variant — zero available, same as the old per-item aggregate
        // returning null sums.
        const availableStock = availableByKey.get(stockKey(item.productId, item.variantId)) ?? 0;

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

    const runCheckout = (orderNumber: string) =>
        prisma.$transaction(async (tx) => {
            const order = await tx.order.create({
                data: {
                    orderNumber,
                    idempotencyKey: payload.idempotencyKey,
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

    // `orderNumber` carries a random suffix, so instead of probing for a free
    // one before inserting (5 sequential reads on every checkout), just insert
    // and let the unique constraint arbitrate — collisions are rare enough that
    // the retry costs nothing in the common case.
    let created;
    for (let attempt = 0; ; attempt += 1) {
        try {
            created = await runCheckout(generateOrderNumber());
            break;
        } catch (error) {
            // Concurrent request with the same key won the race: it created the
            // order, so return that one instead of failing this retry.
            if (payload.idempotencyKey && violatedTarget(error, "idempotencyKey")) {
                const winner = await findReplayableOrder(payload.idempotencyKey, customer.id);
                if (winner) {
                    return { order: winner, isReplay: true };
                }
            }

            if (violatedTarget(error, "orderNumber") && attempt < 4) {
                continue;
            }

            throw error;
        }
    }

    // Deliberately not awaited: this runs after the order has already committed
    // and cannot change its outcome, but each call costs a product lookup, a
    // stock aggregate, a user lookup and a write — enough, across a multi-item
    // cart, to push the response past the storefront's timeout. Errors are
    // caught explicitly so an unhandled rejection can't take the process down.
    void Promise.all(
        cart.items.map((item) =>
            StockService.notifyIfLowStock(item.productId, item.variantId, item.product.name),
        ),
    ).catch((error) => console.error("Low-stock notification failed after checkout:", error));

    return { order: created, isReplay: false };
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
