import status from "http-status";
import { RoleName } from "../../constants/role.constant";
import AppError from "../../errorHelpers/AppError";
import {
    AddressType,
    NotificationType,
    OrderStatus,
    PaymentMethod,
    PaymentStatus,
    Prisma,
    ProductStatus,
    StockMovementType,
} from "../../../generated/prisma/client";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { normalizePhone } from "../../utils/phone";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { CouponService } from "../coupon/coupon.service";
import { CustomerService } from "../customer/customer.service";
import { NotificationService } from "../notification/notification.service";
import { StockService } from "../stock/stock.service";
import { StoreSettingService } from "../store-setting/store-setting.service";
import {
    ICheckoutActor,
    ICheckoutItemPayload,
    ICreateOrderPayload,
    IOrderItemData,
    IUpdateOrderStatusPayload,
} from "./order.interface";

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

/** One cart line, reduced to what stock deduction actually needs. */
type IDeductibleLine = {
    productId: string;
    variantId: string | null;
    quantity: number;
    productName: string;
};

/**
 * Deducts every order line from the warehouse-scoped `Stock` ledger in one
 * pass, largest-available-quantity warehouse first, splitting across warehouses
 * when one alone doesn't cover a line (per `api/checkout` spec's "Checkout
 * validates stock and price..." requirement). Writes one `StockMovement`
 * (`type: SALE`, negative `quantity`) per contributing warehouse, then applies
 * each line's total delta to the denormalized `Product`/`ProductVariant
 * .stockQuantity` (kept in sync by this same mechanism on the receiving end —
 * see `api/inventory` spec).
 *
 * Batched across lines rather than per line: the ledger is still re-read inside
 * the transaction, so a concurrent order still can't double-spend the same
 * stock, but one read covers every line instead of one read each, and the
 * writes go out as three statements rather than four per contributing
 * warehouse. On a Singapore-hosted database that took a two-item checkout's
 * deduction from ~390ms to roughly one round trip; the saving grows with cart
 * size. Throws (aborting the transaction) if the re-check comes up short.
 */
const deductStockForOrderLines = async (
    tx: Prisma.TransactionClient,
    orderId: string,
    lines: IDeductibleLine[],
) => {
    const stockKeyOf = (productId: string, variantId: string | null) =>
        `${productId}:${variantId ?? ""}`;

    // One read for every line's warehouse rows. `variantId` is part of the
    // grouping key rather than the filter, so a product's variant rows and its
    // variant-less rows stay distinct — matching the old per-line
    // `where: { productId, variantId }` exactly.
    const stockRows = await tx.stock.findMany({
        where: { productId: { in: lines.map((line) => line.productId) } },
        orderBy: { quantity: "desc" },
    });

    const rowsByKey = new Map<string, typeof stockRows>();
    for (const row of stockRows) {
        const key = stockKeyOf(row.productId, row.variantId);
        const bucket = rowsByKey.get(key);
        if (bucket) bucket.push(row);
        else rowsByKey.set(key, [row]);
    }

    const decrements: { id: string; take: number }[] = [];
    const movements: Prisma.StockMovementCreateManyInput[] = [];

    for (const line of lines) {
        let remaining = line.quantity;

        for (const row of rowsByKey.get(stockKeyOf(line.productId, line.variantId)) ?? []) {
            if (remaining <= 0) break;

            const available = row.quantity - row.reservedQuantity;
            if (available <= 0) continue;

            const take = Math.min(available, remaining);

            decrements.push({ id: row.id, take });
            movements.push({
                productId: line.productId,
                variantId: line.variantId,
                warehouseId: row.warehouseId,
                type: StockMovementType.SALE,
                quantity: -take,
                referenceId: orderId,
            });

            // The same warehouse row can serve two lines (a product and one of
            // its variants never share a row, but two lines of the same
            // product/variant pair would). Reflect the take locally so the
            // second line sees what the first already claimed.
            row.quantity -= take;
            remaining -= take;
        }

        if (remaining > 0) {
            throw new AppError(
                status.CONFLICT,
                `Insufficient stock for "${line.productName}" — stock changed since checkout started`,
            );
        }
    }

    // Every decrement in one statement. `CASE` keeps the per-row amounts
    // distinct, and summing lets one row take from two lines correctly.
    if (decrements.length > 0) {
        const totalById = new Map<string, number>();
        for (const { id, take } of decrements) {
            totalById.set(id, (totalById.get(id) ?? 0) + take);
        }

        await tx.$executeRaw`
            UPDATE "Stock" AS s
            SET quantity = s.quantity - v.take
            FROM (
                SELECT * FROM unnest(
                    ${[...totalById.keys()]}::text[],
                    ${[...totalById.values()]}::int[]
                ) AS t(id, take)
            ) AS v
            WHERE s.id = v.id
        `;
    }

    await tx.stockMovement.createMany({ data: movements });

    // Denormalized totals, batched the same way — variant-scoped lines update
    // ProductVariant, the rest update Product (see applyDenormalizedStockDelta,
    // which this mirrors for the single-row case).
    const variantDeltas = new Map<string, number>();
    const productDeltas = new Map<string, number>();
    for (const line of lines) {
        const target = line.variantId ? variantDeltas : productDeltas;
        const key = line.variantId ?? line.productId;
        target.set(key, (target.get(key) ?? 0) + line.quantity);
    }

    if (variantDeltas.size > 0) {
        await tx.$executeRaw`
            UPDATE "ProductVariant" AS pv
            SET "stockQuantity" = pv."stockQuantity" - v.qty
            FROM (
                SELECT * FROM unnest(
                    ${[...variantDeltas.keys()]}::text[],
                    ${[...variantDeltas.values()]}::int[]
                ) AS t(id, qty)
            ) AS v
            WHERE pv.id = v.id
        `;
    }

    if (productDeltas.size > 0) {
        await tx.$executeRaw`
            UPDATE "Product" AS p
            SET "stockQuantity" = p."stockQuantity" - v.qty
            FROM (
                SELECT * FROM unnest(
                    ${[...productDeltas.keys()]}::text[],
                    ${[...productDeltas.values()]}::int[]
                ) AS t(id, qty)
            ) AS v
            WHERE p.id = v.id
        `;
    }
};

/** Order states that still tie up stock and courier capacity, for the guest COD cap. */
const UNFULFILLED_COD_STATUSES: OrderStatus[] = [OrderStatus.PENDING, OrderStatus.CONFIRMED];

/**
 * Guest checkout has neither a session nor a payment step, so nothing
 * intrinsic stops one visitor placing COD orders until the warehouse is
 * drained — every one of them deducting real stock and costing a real courier
 * run. Two limits, both read from `StoreSetting` so they can be retuned
 * without a deploy:
 *
 *   - per phone: how many unfulfilled COD orders one number may hold at once
 *   - per IP: how many guest orders one address may place per hour
 *
 * Counted from `Order` rows rather than an in-memory counter, which would be
 * wrong the moment there are two instances and lost on every restart. The
 * trade-off is that only *successful* orders count, so this throttles abuse
 * rather than a flood of failing attempts — that is a reverse-proxy concern.
 *
 * Called before the checkout transaction opens so a rejection never touches
 * stock.
 */
const enforceGuestOrderLimits = async (customerId: string, ip: string) => {
    const setting = await StoreSettingService.getStoreSetting();

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const [pendingForPhone, recentForIp] = await Promise.all([
        prisma.order.count({
            where: {
                customerId,
                isGuestOrder: true,
                status: { in: UNFULFILLED_COD_STATUSES },
            },
        }),
        prisma.order.count({
            where: { guestIp: ip, isGuestOrder: true, createdAt: { gte: oneHourAgo } },
        }),
    ]);

    if (pendingForPhone >= setting.maxPendingCodOrdersPerPhone) {
        throw new AppError(
            status.TOO_MANY_REQUESTS,
            `This number already has ${pendingForPhone} order(s) awaiting delivery. Please receive them before placing another.`,
        );
    }

    if (recentForIp >= setting.maxGuestOrdersPerIpPerHour) {
        throw new AppError(
            status.TOO_MANY_REQUESTS,
            "Too many orders placed from this connection. Please try again later.",
        );
    }
};

/** A cart-shaped view of checkout lines, so both sources feed one pricing path. */
type ICheckoutLine = {
    productId: string;
    variantId: string | null;
    quantity: number;
    product: Awaited<ReturnType<typeof prisma.product.findUniqueOrThrow>>;
    variant: Awaited<ReturnType<typeof prisma.productVariant.findUnique>>;
};

/**
 * Loads payload-supplied checkout lines into the same shape the cart yields,
 * so everything downstream — stock checks, pricing, coupon validation — runs
 * on one representation regardless of where the lines came from.
 *
 * The client sends only ids and quantities. Names, SKUs and prices are read
 * from the database here; a price arriving in the request body is never
 * trusted, or a landing page could order anything for anything.
 */
const loadPayloadLines = async (items: ICheckoutItemPayload[]): Promise<ICheckoutLine[]> => {
    // Merge duplicate lines for the same product/variant, so ordering the same
    // item twice in one payload checks stock against the combined quantity
    // rather than each half separately.
    const merged = new Map<string, ICheckoutItemPayload>();
    for (const item of items) {
        const key = `${item.productId}:${item.variantId ?? ""}`;
        const existing = merged.get(key);
        if (existing) existing.quantity += item.quantity;
        else merged.set(key, { ...item });
    }
    const deduped = [...merged.values()];

    const [products, variants] = await Promise.all([
        prisma.product.findMany({
            where: { id: { in: deduped.map((i) => i.productId) } },
        }),
        prisma.productVariant.findMany({
            where: {
                id: { in: deduped.map((i) => i.variantId).filter((id): id is string => !!id) },
            },
        }),
    ]);

    const productById = new Map(products.map((p) => [p.id, p]));
    const variantById = new Map(variants.map((v) => [v.id, v]));

    return deduped.map((item) => {
        const product = productById.get(item.productId);
        if (!product) {
            throw new AppError(status.NOT_FOUND, "Product not found");
        }

        const variant = item.variantId ? variantById.get(item.variantId) : null;
        if (item.variantId && (!variant || variant.productId !== item.productId)) {
            throw new AppError(status.BAD_REQUEST, "Variant does not belong to this product");
        }

        return {
            productId: item.productId,
            variantId: item.variantId ?? null,
            quantity: item.quantity,
            product,
            variant: variant ?? null,
        };
    });
};

/**
 * The single point where an authenticated checkout and a guest checkout
 * differ. Both resolve to a `Customer`, a set of lines to order, and a
 * shipping address id — after this, checkout is one code path, so pricing,
 * stock safety, coupon handling and idempotency have exactly one
 * implementation and cannot drift between the two flows.
 */
const resolveCheckoutContext = async (actor: ICheckoutActor, payload: ICreateOrderPayload) => {
    if (actor.kind === "user") {
        const customer = await CustomerService.getOrCreateCustomerByUserId(actor.userId);

        if (payload.shippingAddressId) {
            const address = await prisma.customerAddress.findUnique({
                where: { id: payload.shippingAddressId },
            });
            if (!address || address.customerId !== customer.id) {
                throw new AppError(status.BAD_REQUEST, "Shipping address not found");
            }
        }

        return { customer, shippingAddressId: payload.shippingAddressId, cartId: undefined };
    }

    // --- Guest ---

    if (payload.shippingAddressId) {
        // A guest cannot prove ownership of a stored address, and honouring the
        // id would let anyone ship an order to an address they merely guessed.
        throw new AppError(
            status.BAD_REQUEST,
            "Please provide your full delivery address to place this order",
        );
    }

    if (payload.paymentMethod && payload.paymentMethod !== PaymentMethod.COD) {
        throw new AppError(status.BAD_REQUEST, "Only cash on delivery is available at checkout");
    }

    if (!payload.fullName || !payload.phone || !payload.shippingAddress) {
        throw new AppError(
            status.BAD_REQUEST,
            "Your name, phone number and delivery address are required",
        );
    }

    const customer = await CustomerService.getOrCreateCustomerByPhone(
        payload.phone,
        payload.fullName,
    );

    // Before anything is created, and well before the transaction opens.
    await enforceGuestOrderLimits(customer.id, actor.ip);

    const address = await prisma.customerAddress.create({
        data: {
            customerId: customer.id,
            type: AddressType.SHIPPING,
            fullName: payload.fullName,
            phone: payload.phone,
            addressLine1: payload.shippingAddress.addressLine1,
            addressLine2: payload.shippingAddress.addressLine2,
            city: payload.shippingAddress.city,
            state: payload.shippingAddress.state,
            postalCode: payload.shippingAddress.postalCode,
            ...(payload.shippingAddress.country
                ? { country: payload.shippingAddress.country }
                : {}),
        },
    });

    return { customer, shippingAddressId: address.id, cartId: undefined };
};

/**
 * Checkout: snapshots the buyer's cart into an immutable Order, per
 * `api/checkout` spec. Serves both an authenticated customer and a guest —
 * `resolveCheckoutContext` absorbs the difference, and everything from the
 * stock check onward is identical for both.
 */
const placeOrder = async (actor: ICheckoutActor, payload: ICreateOrderPayload) => {
    const isGuest = actor.kind === "guest";

    const { customer, shippingAddressId } = await resolveCheckoutContext(actor, payload);

    // Lines come either from the payload (a landing page ordering a product
    // directly) or from the buyer's cart. The cart is only loaded when it is
    // actually the source — and a guest who never touched the cart has no
    // token, hence nothing to load.
    const usePayloadItems = !!payload.items?.length;

    const loadCart = () => {
        if (usePayloadItems) return Promise.resolve(null);

        if (actor.kind === "guest") {
            // No token means this guest never touched the cart, so there is
            // nothing to look up.
            if (!actor.guestToken) return Promise.resolve(null);
            return prisma.cart.findUnique({
                where: { guestToken: actor.guestToken },
                include: { items: { include: { product: true, variant: true } } },
            });
        }

        return prisma.cart.findUnique({
            where: { customerId: customer.id },
            include: { items: { include: { product: true, variant: true } } },
        });
    };

    // Replay check runs before the empty-cart guard below, and that ordering is
    // the whole fix: a retry of a checkout that already committed arrives at an
    // emptied cart, and must return the original order instead of "Your cart is
    // empty" — precisely the failure this change exists to eliminate.
    const [replayedOrder, cart] = await Promise.all([
        payload.idempotencyKey
            ? findReplayableOrder(payload.idempotencyKey, customer.id)
            : Promise.resolve(null),
        loadCart(),
    ]);

    if (replayedOrder) {
        warnIfReplayDiverges(
            payload.idempotencyKey as string,
            replayedOrder.items,
            usePayloadItems
                ? (payload.items as ICheckoutItemPayload[]).map((i) => ({
                      productId: i.productId,
                      variantId: i.variantId ?? null,
                      quantity: i.quantity,
                  }))
                : (cart?.items ?? []),
        );
        return { order: replayedOrder, isReplay: true };
    }

    const lines: ICheckoutLine[] = usePayloadItems
        ? await loadPayloadLines(payload.items as ICheckoutItemPayload[])
        : (cart?.items ?? []).map((item) => ({
              productId: item.productId,
              variantId: item.variantId,
              quantity: item.quantity,
              product: item.product,
              variant: item.variant,
          }));

    if (lines.length === 0) {
        throw new AppError(status.BAD_REQUEST, "Your cart is empty");
    }

    const shippingMethod = payload.shippingMethodId
        ? await prisma.shippingMethod.findUnique({ where: { id: payload.shippingMethodId } })
        : null;

    if (payload.shippingMethodId && (!shippingMethod || !shippingMethod.isActive)) {
        throw new AppError(status.BAD_REQUEST, "Shipping method not found");
    }

    const orderItemsData: IOrderItemData[] = [];
    let subtotal = 0;

    // Availability for every checkout line in one grouped query rather than one
    // aggregate per line. Still summed across every warehouse's
    // Stock.quantity - Stock.reservedQuantity, not the denormalized total —
    // see deductStockForOrderItem above for the actual deduction, which stays
    // per-item because each deduction depends on reading its own warehouse rows.
    const stockRows = await prisma.stock.groupBy({
        by: ["productId", "variantId"],
        where: { productId: { in: lines.map((line) => line.productId) } },
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

    for (const item of lines) {
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
    // (see coupon.constant.ts) against these same checkout lines, one last
    // time, right before the order is committed.
    const appliedCoupon = payload.couponCode
        ? await CouponService.getActiveCouponByCode(payload.couponCode)
        : null;
    const couponResult = appliedCoupon
        ? await CouponService.validateCouponForCart(appliedCoupon, lines, customer.id)
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
                    // The resolved id, not payload.shippingAddressId: a guest's
                    // address was just created from the payload and is the only
                    // one they have.
                    shippingAddressId,
                    isGuestOrder: isGuest,
                    guestIp: isGuest ? actor.ip : undefined,
                    items: { createMany: { data: orderItemsData } },
                    statusHistory: { create: { toStatus: OrderStatus.PENDING } },
                    // Guest checkout is cash-on-delivery only. The Payment row
                    // is created inside this transaction so a COD order can
                    // never commit without one and go missing from reconciliation.
                    ...(isGuest
                        ? {
                              payments: {
                                  create: {
                                      amount: totalAmount,
                                      method: PaymentMethod.COD,
                                      status: PaymentStatus.PENDING,
                                  },
                              },
                          }
                        : {}),
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

            await deductStockForOrderLines(
                tx,
                order.id,
                lines.map((line) => ({
                    productId: line.productId,
                    variantId: line.variantId,
                    quantity: line.quantity,
                    productName: line.product.name,
                })),
            );

            // Clear the cart on success (the Cart row itself is kept for reuse).
            // Skipped for a payload-items checkout, which never consumed a cart
            // — clearing one there would silently discard items the buyer is
            // still shopping for.
            if (cart) {
                await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
            }

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
        lines.map((line) =>
            StockService.notifyIfLowStock(line.productId, line.variantId, line.product.name),
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

/**
 * Guest order tracking. A guest holds no session, so the order number alone
 * cannot authorize this read — order numbers are enumerable, and honouring
 * one on its own would expose any customer's order to anyone who asked.
 * Requiring the phone the order was placed with makes the *pair* the
 * credential.
 *
 * A wrong phone yields 404 rather than 403, matching `getOrderById`: the
 * response must not confirm that an order number exists.
 */
const getGuestOrderByNumberAndPhone = async (orderNumber: string, phone: string) => {
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone) {
        throw new AppError(status.NOT_FOUND, "Order not found");
    }

    const order = await prisma.order.findUnique({
        where: { orderNumber },
        include: ORDER_DETAIL_INCLUDE,
    });

    // One 404 for "no such order", "wrong phone", and "not a guest order"
    // alike — distinguishing them would leak exactly what this guards.
    if (!order || !order.isGuestOrder || order.customer.phone !== normalizedPhone) {
        throw new AppError(status.NOT_FOUND, "Order not found");
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
    getGuestOrderByNumberAndPhone,
    cancelOwnOrder,
    updateOrderStatus,
};
