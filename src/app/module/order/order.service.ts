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
import { currencyFormatOf, formatMoney } from "../../utils/formatMoney";
import { normalizePhone } from "../../utils/phone";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { CouponService } from "../coupon/coupon.service";
import { CustomerService } from "../customer/customer.service";
import { NotificationService } from "../notification/notification.service";
import { StockService } from "../stock/stock.service";
import { StoreSettingService } from "../store-setting/store-setting.service";
import {
    collectMissingCheckoutFields,
    missingCheckoutFieldsMessage,
    submittedCheckoutFields,
} from "./order.checkout-fields";
import {
    ICheckoutActor,
    ICheckoutItemPayload,
    ICheckoutOverrides,
    ICreateOrderPayload,
    IOrderItemData,
    IQuoteCheckoutPayload,
    IUpdateOrderStatusPayload,
} from "./order.interface";
import { IPricingLine, quoteCharges, roundMoney } from "./order.pricing";

const ORDER_DETAIL_INCLUDE = {
    items: true,
    payments: true,
    shipments: true,
    statusHistory: { orderBy: { createdAt: "desc" as const } },
    shippingAddress: true,
    customer: {
        select: { id: true, firstName: true, lastName: true, email: true, phone: true },
    },
    /*
     * The campaign this order came from, when it came from one. Null for every
     * order placed through the normal checkout, and null again once the page
     * has been deleted — which is exactly why `Order.landingPageTitle` is
     * captured at placement and returned alongside it as a scalar. The relation
     * is what makes the admin able to LINK to a page that still exists; the
     * captured title is what keeps a deleted campaign's orders readable.
     *
     * Which delivery area the shopper chose is not here: it is on
     * `shippingAddress.state`, already included above.
     */
    landingPage: { select: { id: true, title: true, slug: true } },
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

/**
 * Stands in for a guest's name when the merchant has turned that field off.
 * CustomerAddress.fullName is NOT NULL and getOrCreateCustomerByPhone refuses
 * an empty name, so the alternative is not "no name" but "no order".
 */
const GUEST_FALLBACK_NAME = "Guest";

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
 * Stores an address the shopper typed into the checkout form.
 *
 * Used by BOTH actor branches below. The rule is about the address, not about
 * the session: an inline address supplied without a saved-address id is the
 * only address that order has, so it is stored and used whoever sent it.
 *
 * It used to live only in the guest branch, on the assumption that an
 * authenticated shopper always picks a saved address. A campaign landing page
 * broke that assumption — it has no address book and no login, so it always
 * sends an address inline — and a signed-in visitor's typed address was
 * silently discarded, leaving the order with none at all.
 *
 * `fullName`, `addressLine1` and `city` are NOT NULL on CustomerAddress, so a
 * field the form did not collect is stored as an empty string rather than null.
 * That is the honest record — "not asked for" — and it keeps every existing
 * reader of an address working unchanged.
 */
const createInlineShippingAddress = async (
    customer: { id: string; firstName: string; lastName: string | null; phone: string | null },
    payload: ICreateOrderPayload,
) =>
    prisma.customerAddress.create({
        data: {
            customerId: customer.id,
            type: AddressType.SHIPPING,
            /*
             * The typed name wins; the customer's own is the fallback. A
             * merchant may legitimately have turned the name field off, and
             * GUEST_FALLBACK_NAME is the last resort — the alternative is not
             * "no name" but "no order", since this column cannot be null.
             */
            fullName:
                payload.fullName?.trim() ||
                [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim() ||
                GUEST_FALLBACK_NAME,
            // The guest branch guarantees a phone before it gets here; an
            // authenticated shopper falls back to the one on their account.
            phone: payload.phone || customer.phone || "",
            addressLine1: payload.shippingAddress?.addressLine1 ?? "",
            addressLine2: payload.shippingAddress?.addressLine2,
            city: payload.shippingAddress?.city ?? "",
            state: payload.shippingAddress?.state,
            postalCode: payload.shippingAddress?.postalCode,
            ...(payload.shippingAddress?.country
                ? { country: payload.shippingAddress.country }
                : {}),
        },
    });

/**
 * The single point where an authenticated checkout and a guest checkout
 * differ. Both resolve to a `Customer`, a set of lines to order, and a
 * shipping address id — after this, checkout is one code path, so pricing,
 * stock safety, coupon handling and idempotency have exactly one
 * implementation and cannot drift between the two flows.
 */
const resolveCheckoutContext = async (
    actor: ICheckoutActor,
    payload: ICreateOrderPayload,
    overrides?: ICheckoutOverrides,
) => {
    if (actor.kind === "user") {
        const customer = await CustomerService.getOrCreateCustomerByUserId(actor.userId);

        let shippingAddress = null;
        if (payload.shippingAddressId) {
            shippingAddress = await prisma.customerAddress.findUnique({
                where: { id: payload.shippingAddressId },
            });
            if (!shippingAddress || shippingAddress.customerId !== customer.id) {
                throw new AppError(status.BAD_REQUEST, "Shipping address not found");
            }
        } else if (payload.shippingAddress) {
            /*
             * A signed-in shopper who typed an address instead of picking a
             * saved one — which is every order from a campaign landing page,
             * since that page has no address book and no login, and `optionalAuth`
             * honours a session if the visitor happens to have one.
             *
             * Without this the typed address was dropped on the floor and the
             * order committed with `shippingAddressId: undefined`, so the admin
             * panel showed "No shipping address on file" for an order that had
             * one — and nobody could deliver it.
             *
             * Unreachable from the normal checkout: its signed-in path sends
             * `shippingAddressId` and its guest path is the branch below, so
             * the two never overlap (see CheckoutForm.tsx).
             */
            shippingAddress = await createInlineShippingAddress(customer, payload);
        }

        return {
            customer,
            // The resolved id, not `payload.shippingAddressId` — an address
            // created just above has an id the payload never carried.
            shippingAddressId: shippingAddress?.id ?? payload.shippingAddressId,
            // Returned alongside the id because shipping is now priced by where
            // the order is going, and reloading the row to read its country
            // would be a second query for something already in hand.
            shippingAddress,
            cartId: undefined,
        };
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

    /*
     * The shop-wide checkout configuration, skipped entirely for a campaign
     * landing page.
     *
     * A landing page asks for three fields — name, phone, address — that this
     * config does not describe, and it applies its own required-field rule
     * before ever calling into here (landing-page.service.ts). Running the
     * shop's six-field map over a payload that was never going to carry a city
     * or a postal code would reject every campaign order for a field the page
     * did not show. `allowGuestCheckout` is skipped with it: publishing a
     * guest-COD landing page IS the merchant opting into guest ordering for
     * that page, which is a later and more specific decision than the shop-wide
     * switch. See ICheckoutOverrides.
     *
     * The phone floor below is NOT part of this and still runs.
     */
    if (!overrides?.bypassCheckoutConfig) {
        /*
         * What checkout is currently configured to ask for. The storefront
         * renders its form from this same config, but the storefront is not the
         * only way to reach this endpoint — so it is re-applied here rather than
         * trusted.
         */
        const checkoutConfig = await StoreSettingService.getCheckoutConfig();

        // Before the address is created and before the guest limits are counted:
        // when guest checkout is off, this request should cost nothing.
        if (!checkoutConfig.allowGuestCheckout) {
            throw new AppError(
                status.UNAUTHORIZED,
                "Please sign in to place an order",
            );
        }

        /*
         * Whether this order is being collected rather than delivered, which
         * suspends the address fields below. Read off the config already loaded
         * here rather than waiting for `quoteCharges` to resolve it, because the
         * answer is needed BEFORE the fields are checked. `quoteDelivery` still
         * re-resolves the same key authoritatively — an unknown key, or a pickup
         * key while collection is off, is refused there — so this lookup decides
         * only which fields to ask for, never a price.
         */
        const chosenOption = checkoutConfig.delivery.options.find(
            (option) => option.key === payload.deliveryOptionKey,
        );

        /*
         * The configurable half of guest validation, driven by the same field
         * keys the admin edits. A merchant who marks City optional makes it
         * genuinely optional here — that is the whole point of the setting.
         */
        const missing = collectMissingCheckoutFields(
            checkoutConfig,
            submittedCheckoutFields(payload),
            chosenOption?.kind === "PICKUP",
        );

        if (missing.length > 0) {
            throw new AppError(status.BAD_REQUEST, missingCheckoutFieldsMessage(missing));
        }
    }

    /*
     * The floor, checked independently of the config above. checkoutConfigSchema
     * refuses to SAVE a config without a required phone; this refuses to ACT on
     * one, so a row edited straight in the database cannot produce an order that
     * its owner can never look up and that the per-phone COD cap cannot count.
     */
    if (!payload.phone) {
        throw new AppError(status.BAD_REQUEST, "Your phone number is required");
    }

    const customer = await CustomerService.getOrCreateCustomerByPhone(
        payload.phone,
        // A merchant may legitimately have turned the name field off. "Guest"
        // keeps the customer record from being created nameless — the phone is
        // the identity here, the name was only ever a courtesy.
        payload.fullName?.trim() || GUEST_FALLBACK_NAME,
    );

    // Before anything is created, and well before the transaction opens.
    await enforceGuestOrderLimits(customer.id, actor.ip);

    const address = await createInlineShippingAddress(customer, payload);

    return { customer, shippingAddressId: address.id, shippingAddress: address, cartId: undefined };
};

/**
 * Checkout: snapshots the buyer's cart into an immutable Order, per
 * `api/checkout` spec. Serves both an authenticated customer and a guest —
 * `resolveCheckoutContext` absorbs the difference, and everything from the
 * stock check onward is identical for both.
 */
const placeOrder = async (
    actor: ICheckoutActor,
    payload: ICreateOrderPayload,
    overrides?: ICheckoutOverrides,
) => {
    const isGuest = actor.kind === "guest";

    const { customer, shippingAddressId, shippingAddress } = await resolveCheckoutContext(
        actor,
        payload,
        overrides,
    );

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

    const orderItemsData: IOrderItemData[] = [];
    // Built alongside the order items in the same loop rather than zipped back
    // together afterwards by index — the two lists must describe the same lines,
    // and an index-aligned pair is one `filter` away from silently pricing the
    // wrong product's tax rule.
    const pricingLines: IPricingLine[] = [];
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

        pricingLines.push({
            productId: item.productId,
            productName: item.product.name,
            quantity: item.quantity,
            lineTotal: totalPrice,
            taxRuleId: item.product.taxRuleId,
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

    // `freeShippingThreshold` still comes from the shop settings — it is a
    // property of the order's value, not of any one product. The tax rate there
    // is now only a fallback: tax comes from each product's own rule (see
    // order.pricing.ts and the `admin/catalog-rules` spec).
    const storeSetting = await StoreSettingService.getStoreSetting();

    const charges = await quoteCharges({
        lines: pricingLines,
        discountAmount,
        /*
         * The shopper's own choice, not anything derived from their address.
         * Absent on the landing-page path below, which prices its own zones.
         */
        ...(payload.deliveryOptionKey ? { deliveryOptionKey: payload.deliveryOptionKey } : {}),
        couponWaivesShipping: Boolean(couponResult?.freeShipping),
        freeShippingThreshold:
            storeSetting.freeShippingThreshold === null
                ? null
                : Number(storeSetting.freeShippingThreshold),
        /*
         * Present only for a campaign landing page, which prices delivery from
         * its own zones. `quoteCharges` skips quoteShipping and ignores both
         * waivers above when it is set — the page stated a delivery charge and
         * that is what is charged. Absent for every other caller, so nothing
         * about the normal checkout moves.
         */
        ...(overrides?.shippingOverride
            ? { shippingOverride: overrides.shippingOverride }
            : {}),
    });

    const { shippingAmount, taxAmount } = charges;

    const totalAmount = roundMoney(subtotal + shippingAmount + taxAmount - discountAmount);

    if (payload.expectedTotal !== undefined && Math.abs(payload.expectedTotal - totalAmount) > 0.01) {
        // Written in the merchant's own currency: a shopper whose basket said
        // "৳1,200.00" cannot act on a message that says "1200.00".
        const money = currencyFormatOf(storeSetting);
        throw new AppError(
            status.CONFLICT,
            `Price mismatch — server computed ${formatMoney(totalAmount, money)}, client expected ${formatMoney(payload.expectedTotal, money)}`,
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
                    /*
                     * The delivery choice, captured. `deliveryOptionLabel` is
                     * written once and never updated, for the same reason
                     * `landingPageTitle` below is: it is what the shopper agreed
                     * to, and renaming or deleting the option afterwards must not
                     * rewrite what this order says. `deliveryMethod` is what tells
                     * staff not to hand a collection order to a courier.
                     *
                     * All three come from the resolved option rather than from the
                     * request body — a client that could name its own label could
                     * name its own price.
                     */
                    deliveryMethod: charges.delivery?.method,
                    deliveryOptionKey: charges.delivery?.optionKey,
                    deliveryOptionLabel: charges.delivery?.optionLabel,
                    // The resolved id, not payload.shippingAddressId: a guest's
                    // address was just created from the payload and is the only
                    // one they have.
                    shippingAddressId,
                    isGuestOrder: isGuest,
                    guestIp: isGuest ? actor.ip : undefined,
                    /*
                     * Campaign attribution. `landingPageTitle` is captured here
                     * and never updated afterwards, so renaming a page does not
                     * rewrite the history of orders placed under the old name,
                     * and deleting one leaves its orders still readable.
                     */
                    landingPageId: overrides?.landingPage?.id,
                    landingPageTitle: overrides?.landingPage?.title,
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
                    // No shipment is opened here. One is created when the parcel
                    // actually goes out (ShipmentService.createShipment), so an
                    // order does not claim a dispatch that has not happened.
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

/**
 * What this basket would cost with this delivery option, without placing
 * anything.
 *
 * Delivery is not a number the storefront can work out for itself even though
 * it holds the option list: a free-delivery threshold or a coupon can waive the
 * charge, and both depend on the subtotal AFTER the order's discount. Tax is
 * per product's own rule. Without this the shopper would see one number at
 * checkout and be charged another.
 *
 * The address no longer takes part. It used to decide the price, which is why
 * this once loaded the shopper's saved address to match on — the shopper's
 * chosen option decides it now, so there is nothing here to look up.
 *
 * Deliberately shares `quoteCharges` with `placeOrder`: two implementations of
 * "what does this cost" is exactly how a quote and a charge drift apart.
 */
const quoteCheckout = async (actor: ICheckoutActor, payload: IQuoteCheckoutPayload) => {
    const customer =
        actor.kind === "user"
            ? await CustomerService.getOrCreateCustomerByUserId(actor.userId)
            : null;

    const cart = payload.items?.length
        ? null
        : await (actor.kind === "guest"
              ? actor.guestToken
                  ? prisma.cart.findUnique({
                        where: { guestToken: actor.guestToken },
                        include: { items: { include: { product: true, variant: true } } },
                    })
                  : Promise.resolve(null)
              : prisma.cart.findUnique({
                    where: { customerId: (customer as { id: string }).id },
                    include: { items: { include: { product: true, variant: true } } },
                }));

    const lines: ICheckoutLine[] = payload.items?.length
        ? await loadPayloadLines(payload.items)
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

    const pricingLines: IPricingLine[] = lines.map((line) => ({
        productId: line.productId,
        productName: line.product.name,
        quantity: line.quantity,
        lineTotal: Number(line.variant?.price ?? line.product.price) * line.quantity,
        taxRuleId: line.product.taxRuleId,
    }));

    const appliedCoupon = payload.couponCode
        ? await CouponService.getActiveCouponByCode(payload.couponCode)
        : null;
    const couponResult =
        appliedCoupon && customer
            ? await CouponService.validateCouponForCart(appliedCoupon, lines, customer.id)
            : null;

    const storeSetting = await StoreSettingService.getStoreSetting();

    /*
     * Priced for the option the shopper has selected. The storefront always has
     * one to send — the option list arrives with the public settings, so it can
     * select a default before this is ever called — and quoting without one
     * would mean showing a total that omits a charge the order will carry.
     */
    const charges = await quoteCharges({
        lines: pricingLines,
        discountAmount: couponResult?.discountAmount ?? 0,
        deliveryOptionKey: payload.deliveryOptionKey,
        couponWaivesShipping: Boolean(couponResult?.freeShipping),
        freeShippingThreshold:
            storeSetting.freeShippingThreshold === null
                ? null
                : Number(storeSetting.freeShippingThreshold),
    });

    const discountAmount = couponResult?.discountAmount ?? 0;

    return {
        subtotal: charges.subtotal,
        discountAmount,
        taxAmount: charges.taxAmount,
        shippingAmount: charges.shippingAmount,
        /** What delivery costs before any waiver — so "Free" can be shown as a saving. */
        shippingBeforeWaiver: charges.shippingBeforeWaiver,
        deliveryDays: charges.deliveryDays,
        totalAmount: roundMoney(
            charges.subtotal + charges.shippingAmount + charges.taxAmount - discountAmount,
        ),
        /**
         * Echoed back so the storefront can confirm it priced what the shopper
         * sees selected, and so a stale key surfaces as a mismatch rather than
         * as a silently different total.
         */
        delivery: charges.delivery && {
            optionKey: charges.delivery.optionKey,
            optionLabel: charges.delivery.optionLabel,
            method: charges.delivery.method,
            price: charges.delivery.price,
            days: charges.delivery.days,
        },
    };
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
    quoteCheckout,
    getOrders,
    getOrderById,
    getGuestOrderByNumberAndPhone,
    cancelOwnOrder,
    updateOrderStatus,
};
