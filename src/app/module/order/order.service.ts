import status from "http-status";
import { RoleName } from "../../constants/role.constant";
import AppError from "../../errorHelpers/AppError";
import {
    AddressType,
    AuditAction,
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
import { AuditLogService } from "../audit-log/audit-log.service";
import { CampaignService } from "../campaign/campaign.service";
import { CouponService } from "../coupon/coupon.service";
import { CustomerService } from "../customer/customer.service";
import { reportPurchaseToCapi } from "../integration/facebook-capi";
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
    IManualOrderPayload,
    IOrderItemData,
    IQuoteCheckoutPayload,
    IUpdateOrderStatusPayload,
} from "./order.interface";
import { IPricingLine, quoteCharges, roundMoney } from "./order.pricing";

/**
 * What the items read needs to paint each line's thumbnail.
 *
 * The item snapshot faithfully replays the product's name and sku from
 * PLACEMENT, and it must — those are the words the shopper was sold. The image
 * is deliberately not treated the same way: a picture is decoration, not a
 * fact the parcel is accountable for, and marketing swaps the primary thumbnail
 * without that lying about anything the order won. So the image ships as
 * today's catalog picture, read through the same primary-first order the admin
 * product list uses — a staff read naming money needs to say what the parcel
 * actually looks like now, the same way it would if the operator asked for the
 * product. See the `image` COLLAPSE below.
 *
 * `variant` carries its own derived `image` (see `ProductVariant.image`); an
 * item naming a variant prefers that, and one sold as a plain product falls
 * back to the product's primary image, sharing the `PRIMARY_IMAGE_FIRST` order
 * so the two read identically.
 */
const ORDER_ITEM_IMAGE_INCLUDE = {
    product: {
        select: {
            /*
             * Primary image first, then authored order — the same ordering
             * `ORDER_DETAIL_INCLUDE`'s sibling in product.service.ts declares
             * as `PRIMARY_IMAGE_FIRST`. Kept inline here rather than imported:
             * that constant is this module's neighbour, not something worth a
             * cross-module dependency for one `orderBy`.
             */
            images: {
                orderBy: [{ isPrimary: "desc" as const }, { sortOrder: "asc" as const }],
                take: 1,
                select: { url: true },
            },
        },
    },
    variant: { select: { image: true } },
};
/*
 * Note the absence of a trailing `as const`, which this object carried when it
 * was introduced and which did not compile.
 *
 * `as const` makes `orderBy` above a READONLY tuple, and Prisma's
 * `Product$imagesArgs.orderBy` is a mutable array — so the whole include failed
 * to typecheck, and with it Prisma's inference for every read that used it:
 * `order.items` and `order.customer` stopped existing on the result type, which
 * is where the rest of the module's errors came from. Fourteen in total, none
 * of them visible in dev, because `tsx` does not typecheck and the server has
 * no test runner.
 *
 * The per-string `as const` above is the part that was actually needed — it
 * pins `"desc"`/`"asc"` to their literal types, which is all Prisma asks for.
 * Widening the object to readonly was never required and is what broke it.
 */

const ORDER_DETAIL_INCLUDE = {
    items: { include: ORDER_ITEM_IMAGE_INCLUDE },
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
     * Which delivery option a SHOP order chose is not here either: it is on the
     * order's own `deliveryMethod` / `deliveryOptionKey` / `deliveryOptionLabel`
     * columns, which this `include` returns as scalars without being named. A
     * LANDING-PAGE order leaves those null and carries its chosen zone on
     * `shippingAddress.state` instead, since its zones are the page's own.
     */
    landingPage: { select: { id: true, title: true, slug: true } },
};

const ORDER_LIST_INCLUDE = {
    /*
     * Customer contact, so the admin's orders list can show who is ordering —
     * name, phone and email — without a per-row detail request for a customer
     * that is already sitting in the row. The address ships below as its own
     * relation, since it is the parcel's address rather than the account's.
     */
    customer: {
        select: { id: true, firstName: true, lastName: true, email: true, phone: true },
    },
    /*
     * The delivery address, so the list can show where each parcel goes.
     * Whole row — the same shape the detail read returns — so list and detail
     * render an address identically. Null for collection orders, which have no
     * address at all.
     */
    shippingAddress: true,
    /*
     * Line items, so the admin's orders list can name what each order bought.
     * Detached from the N+1 concern that shaped `shipments` below: items are a
     * single relation on the already-fetched order rows, not a query per row.
     *
     * The staff list keeps `unitCost` (same include detail uses); the
     * customer-facing list strips it in `getOrders`, because an order list a
     * customer can read must never carry supplier cost.
     *
     * Each line carries its thumbnail too, on the same reasoning: the picture is
     * a join onto order rows already being fetched, not a request per row. An
     * operator packing parcels reads the LIST, and making them open every order
     * to see what is in it costs exactly as much as not showing the picture at
     * all. Shares `ORDER_ITEM_IMAGE_INCLUDE` with the detail read so the two
     * surfaces resolve an image identically.
     */
    items: { include: ORDER_ITEM_IMAGE_INCLUDE },
    /*
     * Courier state, so the admin's orders list can show at a glance which
     * parcels are with Steadfast and where they are.
     *
     * Narrowly selected rather than `shipments: true`: this include serves a
     * paginated list, and the alternative to carrying these three columns is the
     * admin fetching a shipment per row — the N+1 pattern integrate-orders-api
     * explicitly removed. Everything else about a shipment belongs to the detail
     * read, which already returns the whole row.
     *
     * `orderBy` and `take` make it deterministic: an order has at most one
     * shipment today, and if split shipments ever arrive this keeps the list
     * showing the newest rather than an arbitrary one.
     */
    shipments: {
        select: { consignmentId: true, courierStatus: true, trackingNumber: true },
        orderBy: { createdAt: "desc" as const },
        take: 1,
    },
};

/**
 * Collapses the nested image relations `ORDER_ITEM_IMAGE_INCLUDE` returns on
 * each line — `variant.image`, else the product's primary thumbnail — into one
 * flat `image: string | null`, and drops the nested `product`/`variant` rows
 * from the item.
 *
 * Dropped rather than left riding along: the include exists to fetch exactly
 * three bytes of picture, and the two relations it adds ARE those three bytes
 * plus a lot of row they were never meant to carry. A flattened item is one
 * scalar richer and whole relations lighter; any read that forgets the flatten
 * would ship both full rows where the design said one thumbnail.
 *
 * Images stay on every path — staff and customer — because pictures are not
 * the supplier-cost concern `withoutItemCosts` guards; a customer's own order
 * may know what the product they bought looks like.
 *
 * That claim used to be false in exactly the way it was written to prevent.
 * This function was only ever reached from INSIDE `withoutItemCosts`, so the
 * cost strip's audience silently became the flatten's audience: staff reads,
 * which never strip cost, never flattened either, and returned the raw nested
 * `product`/`variant` relations that no client reads. Every order read calls
 * this directly now, and `withoutItemCosts` does one job — cost — on top.
 * Two different questions ("may this reader see supplier cost?" and "what shape
 * is a line?") must not be answered by one call.
 */
const flattenItemImages = <T extends { items: unknown[] }>(order: T): T => ({
    ...order,
    items: order.items.map((item) => {
        const {
            product,
            variant,
            ...rest
        } = item as Record<string, unknown> & {
            product?: { images?: { url: string }[] } | null;
            variant?: { image?: string | null } | null;
        };
        return { ...rest, image: variant?.image ?? product?.images?.[0]?.url ?? null };
    }),
}) as unknown as T;

/**
 * Drops `OrderItem.unitCost` from an order on its way to a shopper.
 *
 * `ORDER_DETAIL_INCLUDE` above spreads whole `OrderItem` rows, so the cost
 * snapshot captured at placement rides along by default. It is supplier cost —
 * admin-only, exactly like `Product.purchasePrice` — and `api/checkout` spec
 * forbids it on any customer-facing response.
 *
 * Stripped at the boundary rather than by narrowing the include, because the
 * SAME include serves the staff reads that exist precisely to see cost. A
 * narrowed include would have to be duplicated and would then drift.
 *
 * `ORDER_LIST_INCLUDE` now returns items too — the admin's orders table names
 * what each order bought — so the same boundary strip applies to a CUSTOMER's
 * own order list. Staff keep the cost, and never the other way round.
 *
 * Cost ONLY. This used to call `flattenItemImages` as its first step, which
 * made the image shape a property of who was reading rather than of the
 * endpoint — see that function's comment. Callers flatten; this strips.
 */
const withoutItemCosts = <T extends { items: unknown[] }>(order: T): T => ({
    ...order,
    items: order.items.map((item) => {
        const row = { ...(item as Record<string, unknown>) };
        delete row.unitCost;
        return row;
    }),
}) as unknown as T;

/**
 * Both boundary steps in one: flatten each line's image, then drop supplier
 * cost. What every read that must not disclose cost returns.
 *
 * Named for what it does rather than for who reads it, deliberately. The
 * placement response uses it for EVERY actor including staff, which predates
 * this change and is left alone — a name asserting an audience would be wrong
 * there, and that wrongness is what let the flatten's audience drift in the
 * first place.
 */
const flattenedWithoutCosts = <T extends { items: unknown[] }>(order: T): T =>
    withoutItemCosts(flattenItemImages(order));

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

    // Rebuild mirrors from the ledger rather than decrementing their previous
    // values. This also repairs a stale mirror if an operator removed stock
    // rows outside the application before this checkout ran.
    const reconciled = new Set<string>();
    for (const line of lines) {
        const key = `${line.productId}:${line.variantId ?? ""}`;
        if (reconciled.has(key)) continue;

        reconciled.add(key);
        await StockService.reconcileDenormalizedStock(tx, line.productId, line.variantId);
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

    /* --- Staff, placing an order on a customer's behalf ---
     *
     * Identical to the guest branch below in the two things that make an order
     * deliverable — the phone is the customer's identity, the address is typed
     * in — and deliberately different in everything that exists to police an
     * anonymous shopper.
     *
     * NOT applied here, each for its own reason:
     *
     *   - `enforceGuestOrderLimits`. Both caps exist because a guest checkout
     *     has nobody accountable behind it. This one has an authenticated,
     *     audited employee, recorded on the order. The per-IP cap would also be
     *     counting the SHOP's own address, so a busy afternoon at the counter
     *     would throttle itself.
     *   - `checkoutConfig`'s six-field map and `allowGuestCheckout`. That config
     *     decides what the STOREFRONT'S FORM asks a shopper for. An operator
     *     recording a sale that already happened is not its audience, and a shop
     *     requiring a postal code online would otherwise refuse a phone order
     *     for a field nobody was in a position to ask.
     *
     * Still applied, because neither is about policing anyone: the phone floor
     * (an order nobody can look up or deliver is not a favour to anyone) and a
     * delivery address. See the spec's "Guest abuse limits do not apply to
     * staff-placed orders".
     */
    if (actor.kind === "staff") {
        if (!payload.phone) {
            throw new AppError(status.BAD_REQUEST, "The customer's phone number is required");
        }

        const customer = await CustomerService.getOrCreateCustomerByPhone(
            payload.phone,
            payload.fullName?.trim() || GUEST_FALLBACK_NAME,
        );

        const address = await createInlineShippingAddress(customer, payload);

        return {
            customer,
            shippingAddressId: address.id,
            shippingAddress: address,
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

    const { customer, shippingAddressId } = await resolveCheckoutContext(actor, payload, overrides);

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

        /*
         * A staff-placed order always carries its own lines, so this is
         * unreachable today — `usePayloadItems` returns above. Stated anyway
         * rather than left to fall through to the customer-cart read below,
         * which would load the CUSTOMER'S OWN live cart and turn whatever they
         * happened to be shopping for into an order the operator never agreed
         * to. That is a silent, plausible, data-destroying failure, and the
         * only thing standing between it and production is a validation rule in
         * another file requiring at least one line.
         */
        if (actor.kind === "staff") return Promise.resolve(null);

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
        // Checkout answers a shopper, never staff — cost is stripped on all
        // three of this function's returns.
        return { order: flattenedWithoutCosts(replayedOrder), isReplay: true };
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

    /*
     * Campaign pricing for this basket, resolved ONCE before the loop — the
     * same resolver and window the storefront's displayed price came from.
     *
     * Without this the order charged `offerPrice` while the product card, the
     * Deal of the Week row and the PDP all advertised the discounted figure:
     * the shopper saw 800, paid 1000, and the order recorded 1000 as if that
     * were the agreed price. A campaign that is not honoured at checkout is
     * worse than no campaign, so this must stay ahead of the pricing below.
     *
     * Resolved here rather than per line so one basket means one query, and so
     * every line is priced against the same instant — a campaign expiring
     * mid-loop must not charge two lines under different rules.
     */
    const campaignPriceByKey = await CampaignService.getActiveDiscountsForLines(
        lines.map((line) => ({
            productId: line.productId,
            variantId: line.variantId,
            unitPrice: Number(line.variant?.offerPrice ?? line.product.offerPrice),
        })),
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

        /*
         * Charged from the offer price, less any active campaign discount.
         * `unitPrice`/`totalPrice` below are OrderItem's own captured columns
         * and keep their names — an order records what was charged, not which
         * catalogue field it came from, which is exactly why the campaign
         * price belongs here rather than as a separate discount line: the
         * campaign sets what the goods cost, it does not rebate them.
         *
         * Rounded to 2dp at the unit, before multiplying: a percentage
         * discount rarely lands on a whole paisa, and rounding only the line
         * total would record a `unitPrice` that does not divide into it.
         */
        const listPrice = Number(item.variant?.offerPrice ?? item.product.offerPrice);
        const unitPrice = roundMoney(
            campaignPriceByKey.get(stockKey(item.productId, item.variantId)) ?? listPrice,
        );
        const totalPrice = roundMoney(unitPrice * item.quantity);
        subtotal += totalPrice;

        /*
         * What this unit COST, captured on the same footing as `unitPrice`
         * above and for the same reason: an order records the transaction as
         * it stood, not as the catalogue later becomes. That matters more now
         * than it used to — purchase-order receipts move `purchasePrice` as a
         * weighted average, so a margin recomputed from the live catalogue
         * would give a different answer after every supplier delivery.
         *
         * `?? null`, never `?? 0`: a product whose cost was never recorded has
         * an UNKNOWN cost, and a zero here would report it as free goods with
         * 100% margin. Same variant-then-product fallback the price above uses.
         */
        const purchasePrice = item.variant?.purchasePrice ?? item.product.purchasePrice;
        const unitCost = purchasePrice == null ? null : Number(purchasePrice);

        orderItemsData.push({
            productId: item.productId,
            variantId: item.variantId,
            productName: item.product.name,
            sku: item.variant?.sku ?? item.product.sku,
            quantity: item.quantity,
            unitPrice,
            totalPrice,
            unitCost,
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

    /*
     * The order's one discount figure, from a coupon or from an operator, never
     * from both — the manual endpoint accepts no coupon code at all, so the two
     * sources cannot meet (design.md, Decision 5).
     *
     * The subtotal bound is checked HERE and not in the validation schema
     * because the subtotal is not knowable until the lines have been read and
     * priced from the catalog; a request body cannot be judged against it.
     * `allocateDiscount` would cap it internally anyway, so this is not what
     * keeps the arithmetic sound — it is what stops an order committing for a
     * total the operator did not intend, silently, instead of telling them.
     */
    const staffDiscount = overrides?.manual?.discount;
    if (staffDiscount && staffDiscount.amount > subtotal) {
        const money = currencyFormatOf(await StoreSettingService.getStoreSetting());
        throw new AppError(
            status.BAD_REQUEST,
            `Discount ${formatMoney(staffDiscount.amount, money)} is more than the order's ${formatMoney(subtotal, money)} — it cannot exceed the subtotal`,
        );
    }

    const discountAmount = staffDiscount?.amount ?? couponResult?.discountAmount ?? 0;

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
                    /*
                     * Set only when a person decided the discount. A coupon
                     * discount is already explained by `couponCode` above, and
                     * writing a reason for one would be inventing a sentence
                     * nobody said.
                     */
                    discountReason: staffDiscount?.reason,
                    notes: payload.notes,
                    /*
                     * Provenance. `channel` defaults to WEBSITE at the database
                     * level, so a shopper's own order needs nothing here and
                     * every row placed before this column existed reads
                     * correctly without a backfill.
                     *
                     * `createdByUserId` is the operator, taken from the ACTOR —
                     * a verified session — and never from the payload, so an
                     * order cannot claim to have been taken by someone else.
                     * Left null for a self-service order, which is what says
                     * the customer placed it themselves.
                     */
                    channel: overrides?.manual?.channel,
                    createdByUserId: actor.kind === "staff" ? actor.staffUserId : undefined,
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
                    /*
                     * A manual order opens its history naming the operator, so
                     * "who entered this" survives even if `createdByUserId` is
                     * ever nulled by a staff account being deleted. A shopper's
                     * own order has nobody to name.
                     */
                    statusHistory: {
                        create: {
                            toStatus: OrderStatus.PENDING,
                            changedById:
                                actor.kind === "staff" ? actor.staffUserId : undefined,
                        },
                    },
                    /*
                     * The condition is "this order is cash-on-delivery", not
                     * "this actor is a guest" — it read as the latter only
                     * because guests were once the only COD population. A
                     * staff-placed order is COD by definition here: the customer
                     * agreed to pay the courier, and money already collected in
                     * advance is recorded afterwards through
                     * `POST /orders/:id/payments` rather than at creation, so
                     * there is one way to record a payment rather than two.
                     *
                     * The row is created inside this transaction so a COD order
                     * can never commit without one and go missing from
                     * reconciliation.
                     *
                     * An AUTHENTICATED storefront order still gets no Payment
                     * row. That predates this change and is left alone —
                     * widening it to every order changes existing reconciliation
                     * and is not what this change is for.
                     */
                    ...(isGuest || actor.kind === "staff"
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
                    return { order: flattenedWithoutCosts(winner), isReplay: true };
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

    // Staff-facing counterpart to the customer's order-confirmation notification:
    // without this a placed order leaves no trace anywhere an admin looks, so the
    // panel has nothing to alert on. Not awaited, for the same reason as above.
    void NotificationService.notifyOwnersAndAdmins(
        NotificationType.ORDER,
        "New order placed",
        `Order ${created.orderNumber} was placed for ${created.totalAmount}.`,
        { link: `/orders/${created.id}` },
    ).catch((error) => console.error("New-order staff notification failed after checkout:", error));

    /*
     * The server-side half of Purchase measurement. Not awaited, for the same
     * reason as the two calls above — and additionally because a shopper must
     * never wait on Meta to see their confirmation.
     *
     * `created.id` is the deduplication key: the confirmation page fires the
     * browser pixel with this same id, and Meta collapses the pair into one
     * conversion. Sending a different id in either place double-counts every
     * sale. See module/integration/facebook-capi.ts.
     *
     * No .catch() here: the function is `void`-returning and swallows its own
     * failures by construction, because a measurement error must never surface
     * on a completed order.
     */
    reportPurchaseToCapi({
        orderId: created.id,
        value: Number(created.totalAmount),
        // Falls back to BDT only if the column is null, which the seed prevents.
        // Meta rejects an event with no currency outright, so an empty string
        // here would silently drop every conversion.
        currency: storeSetting.currency ?? "BDT",
        email: created.customer?.email,
        phone: created.customer?.phone,
        createdAt: created.createdAt,
    });

    return { order: flattenedWithoutCosts(created), isReplay: false };
};

/**
 * Records an order a customer placed off-site — over WhatsApp, Messenger, a
 * phone call or at the counter.
 *
 * Everything that makes an order an order happens in `placeOrder`, the same
 * core the storefront checkout and the campaign landing page both run through:
 * the order number and its collision retry, catalog pricing, stock deduction,
 * the COD payment, the status history, idempotency, and both notifications.
 * This function's whole job is to turn the admin form's payload into that
 * core's payload and to say how a staff-placed order differs. A second
 * implementation of order creation is the risk that shape exists to avoid —
 * see `ICheckoutOverrides` and add-single-product-landing-page design.md,
 * Decision 3.
 *
 * What differs, and nothing else does:
 *
 *   Customer            resolved by PHONE, not by session (the operator has one,
 *                       the customer does not)
 *   Guest COD caps      not enforced — an accountable employee placed this, and
 *                       the per-IP cap would be counting the shop's own address
 *   checkoutConfig      bypassed, fields and `allowGuestCheckout` alike: it
 *                       governs what the STOREFRONT'S FORM asks a shopper
 *   isGuestOrder/IP     false / null
 *   COD Payment row     always created
 *   changedById         the operator, on the opening status-history row
 *   discountAmount      stated by the operator, with a reason, instead of a coupon
 *   channel/createdBy   recorded; a shopper's own order records neither
 *
 * Not in that list, deliberately: the phone floor and the delivery address,
 * which still apply. Neither polices anyone — an order with no phone cannot be
 * looked up or delivered.
 *
 * If this list ever grows past about a dozen rows, the core has stopped being
 * shared and that is the signal to revisit rather than to add a fourteenth.
 */
const placeManualOrder = async (staffUserId: string, payload: IManualOrderPayload) => {
    /*
     * The discount reaches pricing through `ICheckoutOverrides`, not through
     * the payload below, so it stays unreachable from any request body the
     * storefront's own schema accepts. `placeOrder` bounds it against the
     * subtotal once the lines have been priced.
     *
     * `reason` is non-optional in the override's type, and the validation
     * schema requires it whenever an amount is present — so a discount with no
     * stated reason cannot be constructed here.
     */
    const discount =
        payload.discountAmount && payload.discountAmount > 0
            ? { amount: payload.discountAmount, reason: (payload.discountReason ?? "").trim() }
            : undefined;

    return placeOrder(
        { kind: "staff", staffUserId },
        {
            fullName: payload.fullName,
            phone: payload.phone,
            shippingAddress: payload.shippingAddress,
            // The cart bypass. A staff-placed order always names its own lines;
            // it must never consume the CUSTOMER'S live cart, which holds what
            // they are still shopping for rather than what they just agreed to.
            items: payload.items,
            deliveryOptionKey: payload.deliveryOptionKey,
            paymentMethod: PaymentMethod.COD,
            notes: payload.notes,
            idempotencyKey: payload.idempotencyKey,
            // No couponCode: a manual order takes a stated discount instead, and
            // the two must never both write the order's one discount figure.
        },
        {
            manual: { channel: payload.channel, ...(discount ? { discount } : {}) },
        },
    );
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
    /*
     * A staff quote prices lines the operator has typed, for a customer who has
     * no session here and may not exist yet. It resolves NO customer — `user`
     * below would run `getOrCreateCustomerByUserId` on the operator's own
     * account, quietly filing an employee in the customer list every time they
     * priced a basket, and inflating any count derived from those rows. Pricing
     * must have no side effects.
     */
    const isStaffQuote = actor.kind === "staff";

    if (isStaffQuote && !payload.items?.length) {
        // There is no cart to fall back to — see `cart` below.
        throw new AppError(status.BAD_REQUEST, "Add at least one product to price this order");
    }

    const customer =
        actor.kind === "user"
            ? await CustomerService.getOrCreateCustomerByUserId(actor.userId)
            : null;

    /*
     * No cart read on the staff path either, and not merely because the guard
     * above makes it unreachable: the `user` branch keys on `customer.id`,
     * which is null here, and the customer whose order this is has a cart of
     * their own that has nothing to do with what the operator is pricing.
     */
    const cart =
        payload.items?.length || isStaffQuote
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

    /*
     * The same campaign resolution the placement path runs, for the same
     * reason and by the same call. A quote that omitted campaigns would show a
     * total the order then undercuts — the mirror of the bug this fixes, and
     * just as damaging to trust in the number.
     */
    const quotedCampaignPriceByKey = await CampaignService.getActiveDiscountsForLines(
        lines.map((line) => ({
            productId: line.productId,
            variantId: line.variantId,
            unitPrice: Number(line.variant?.offerPrice ?? line.product.offerPrice),
        })),
    );

    const pricingLines: IPricingLine[] = lines.map((line) => {
        const listPrice = Number(line.variant?.offerPrice ?? line.product.offerPrice);
        const unitPrice = roundMoney(
            quotedCampaignPriceByKey.get(`${line.productId}:${line.variantId ?? ""}`) ?? listPrice,
        );

        return {
            productId: line.productId,
            productName: line.product.name,
            quantity: line.quantity,
            lineTotal: roundMoney(unitPrice * line.quantity),
            taxRuleId: line.product.taxRuleId,
        };
    });

    // No coupon on the staff path — a manual order takes a stated discount
    // instead, and the two must never both write the order's one discount
    // figure (design.md, Decision 5).
    const appliedCoupon =
        payload.couponCode && !isStaffQuote
            ? await CouponService.getActiveCouponByCode(payload.couponCode)
            : null;
    const couponResult =
        appliedCoupon && customer
            ? await CouponService.validateCouponForCart(appliedCoupon, lines, customer.id)
            : null;

    /*
     * The discount this order is priced under: an operator's stated figure on a
     * staff quote, a coupon's computed one otherwise.
     *
     * Capped at the subtotal, which is only knowable here — the lines had to be
     * read and priced first. `allocateDiscount` caps internally too, so this is
     * not what keeps the arithmetic sound; it is what stops the QUOTE reporting
     * a total the placement will refuse, which on this endpoint means an
     * operator reading an impossible figure to a customer.
     */
    const quotedSubtotal = roundMoney(
        pricingLines.reduce((sum, line) => sum + line.lineTotal, 0),
    );
    const discountAmount = isStaffQuote
        ? Math.min(roundMoney(payload.discountAmount ?? 0), quotedSubtotal)
        : (couponResult?.discountAmount ?? 0);

    const storeSetting = await StoreSettingService.getStoreSetting();

    /*
     * Priced for the option the shopper has selected. The storefront always has
     * one to send — the option list arrives with the public settings, so it can
     * select a default before this is ever called — and quoting without one
     * would mean showing a total that omits a charge the order will carry.
     */
    const charges = await quoteCharges({
        lines: pricingLines,
        discountAmount,
        deliveryOptionKey: payload.deliveryOptionKey,
        couponWaivesShipping: Boolean(couponResult?.freeShipping),
        freeShippingThreshold:
            storeSetting.freeShippingThreshold === null
                ? null
                : Number(storeSetting.freeShippingThreshold),
    });

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
        /*
         * `channel` joins `status` here rather than being filtered by a client:
         * the admin list is paginated, so filtering a page would answer "WhatsApp
         * orders among the ten you happen to be looking at" while reading as
         * "WhatsApp orders". Served by `@@index([channel])`, and the two combine
         * — an operator narrows by both at once.
         */
        filterableFields: ["status", "channel"],
    });

    queryBuilder.search().filter().sort().paginate().include(ORDER_LIST_INCLUDE);

    if (!isStaffRole(role)) {
        const customer = await CustomerService.getOrCreateCustomerByUserId(userId);
        queryBuilder.where({ customerId: customer.id });
    }

    const result = await queryBuilder.execute();

    /*
     * `ORDER_LIST_INCLUDE` carries `items`, and with them two things that need
     * handling at the boundary rather than in the include.
     *
     * The image relations are flattened for EVERYONE: a line's shape is a
     * property of the endpoint, not of who is asking, and staff read this list
     * to match parcels against a shelf. The `unitCost` strip is the one that
     * genuinely depends on the reader — it is supplier cost, admin-only, like
     * `Product.purchasePrice` — so only the non-staff path takes it, and never
     * by narrowing the include that staff rely on for real numbers.
     *
     * QueryBuilder works on `unknown` rows; the rows are orders built from
     * ORDER_LIST_INCLUDE, which always carry `items`.
     */
    result.data = result.data.map((order) =>
        isStaffRole(role)
            ? flattenItemImages(order as { items: unknown[] })
            : flattenedWithoutCosts(order as { items: unknown[] }),
    );

    return result;
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

        return flattenedWithoutCosts(order);
    }

    /*
     * Staff only: the transitions this order may still make, so the admin
     * offers exactly what the service will accept. Derived from the same map
     * the guard enforces — a UI listing the statuses independently is how a
     * completed return became re-completable in the returns module.
     *
     * Flattened like every other read. Staff keep `unitCost`; what they do not
     * keep is a DIFFERENT item shape from the one the customer branch above
     * returns, which is what this branch used to hand back — the raw nested
     * `product`/`variant` relations, which no client reads.
     */
    return {
        ...flattenItemImages(order),
        allowedTransitions: allowedOrderTransitions(order.status),
    };
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

    // Guest tracking has no staff variant — this read is always a shopper's.
    return flattenedWithoutCosts(order);
};

/** Order states from which a customer may still cancel their own order — before fulfillment has actually started. */
const CUSTOMER_CANCELLABLE_STATUSES: OrderStatus[] = [OrderStatus.PENDING, OrderStatus.CONFIRMED];

/**
 * Order states from which cancelling still returns stock to the shelf.
 *
 * Past these the goods have left the building, and getting them back is what
 * the return flow is for — a cancellation that restocked a delivered order
 * would credit stock nobody has.
 */
const RESTOCKABLE_ON_CANCEL_STATUSES: OrderStatus[] = [
    OrderStatus.PENDING,
    OrderStatus.CONFIRMED,
    OrderStatus.PROCESSING,
    // A packed parcel is boxed but still on the premises — nobody has the goods
    // yet, so cancelling one must credit its stock back. This is the last state
    // where that is true; SHIPPED onward the goods have left and come back
    // through the return flow instead.
    OrderStatus.PACKED,
];

/**
 * Where an order may go next, from where it is: currently anywhere but where it
 * already is.
 *
 * This was a directed forward-only map (PENDING -> CONFIRMED -> PROCESSING ->
 * PACKED -> SHIPPED -> DELIVERED -> COMPLETED, with CANCELLED reachable up to
 * PACKED and CANCELLED/COMPLETED terminal). It was opened up on the merchant's
 * explicit instruction: the map had no reverse edges at all, so an operator who
 * advanced an order by mistake — the single most common admin slip — had no way
 * to put it back, and a cancelled order could never be revived even when the
 * customer rang back the same minute.
 *
 * What the forward-only map was protecting, and where that protection now
 * lives:
 *
 * - Stock. Cancelling restocks, and a CANCELLED -> PENDING -> CANCELLED loop
 *   would otherwise credit the same goods twice. It does not:
 *   `restockCancelledOrder` nets SALE movements against the CANCELLATION
 *   movements it has already written and restores only the outstanding
 *   remainder, so a second cancellation of the same order finds nothing left to
 *   restore and writes nothing. That idempotence was deliberate — see its
 *   doc comment, which states it does not rely on the terminal-status guard.
 * - Physical impossibility. A DELIVERED order moving back to PENDING says
 *   something untrue about where the goods are. Nothing in the code depends on
 *   it being false, and `OrderStatusHistory` records every hop with its actor,
 *   so a correction stays visible as a correction rather than silently
 *   rewriting the past.
 *
 * `RESTOCKABLE_ON_CANCEL_STATUSES` is now the only thing standing between a
 * delivered order and phantom stock — cancelling from SHIPPED or later writes
 * the status without crediting stock nobody has. Keep that list accurate.
 *
 * If a forward-only flow is ever wanted back, restore the map below rather than
 * scattering per-transition checks:
 *   PENDING:   [CONFIRMED, PROCESSING, CANCELLED]
 *   CONFIRMED: [PROCESSING, SHIPPED, CANCELLED]
 *   PROCESSING:[PACKED, SHIPPED, CANCELLED]
 *   PACKED:    [SHIPPED, CANCELLED]
 *   SHIPPED:   [DELIVERED]   DELIVERED: [COMPLETED]   CANCELLED/COMPLETED: []
 * See openspec/changes/add-order-fulfillment-documents, design.md Decision 6.
 */
const ORDER_STATUSES: OrderStatus[] = Object.values(OrderStatus);

/**
 * The transitions still available from `from` — the admin offers exactly these.
 *
 * Every status except the current one: `updateOrderStatus` rejects a no-op
 * separately with a clearer message, and offering the current status in the
 * admin's dropdown would only invite that error.
 */
const allowedOrderTransitions = (from: OrderStatus): OrderStatus[] =>
    ORDER_STATUSES.filter((candidate) => candidate !== from);

const assertOrderTransitionAllowed = (from: OrderStatus, to: OrderStatus) => {
    if (!allowedOrderTransitions(from).includes(to)) {
        const allowed = allowedOrderTransitions(from);
        throw new AppError(
            status.BAD_REQUEST,
            allowed.length === 0
                ? `A ${from} order is final and cannot be moved to ${to}`
                : `Cannot move an order from ${from} to ${to} — allowed from here: ${allowed.join(", ")}`,
        );
    }
};

/**
 * Returns a cancelled order's stock to the shelves it came off.
 *
 * Placing an order deducts real stock. Cancelling it used to write only the
 * status and a history row, so the goods sat in the warehouse while the system
 * believed they were gone — every cancellation permanently shrinking sellable
 * inventory, with nothing reporting it.
 *
 * The warehouses come from the order's own `SALE` movements rather than being
 * chosen here: `deductStockForOrderLines` may split one line across several
 * warehouses when no single one covers it, and only those movements record how
 * it actually split. Picking a warehouse instead would move stock between
 * buildings on paper.
 *
 * Idempotent by construction: it reverses only what has not already been
 * reversed, comparing `SALE` movements against `CANCELLATION` ones for the same
 * order. The terminal-status guard normally prevents a second cancellation,
 * but stock is not something to protect with only one guard.
 */
const restockCancelledOrder = async (tx: Prisma.TransactionClient, orderId: string) => {
    // Guard: only attempt restock if there are actual SALE movements to reverse.
    // If an order has no SALE movement (stock was never deducted), restocking
    // would invent phantom stock. This prevents 50 -> 51 scenarios where an order
    // was created without proper stock deduction but then cancelled.
    const hasSaleMovement = await tx.stockMovement.findFirst({
        where: {
            referenceId: orderId,
            type: StockMovementType.SALE,
        },
        select: { id: true },
    });

    if (!hasSaleMovement) {
        return;  // No SALE movement to reverse — nothing to restore
    }

    const movements = await tx.stockMovement.findMany({
        where: {
            referenceId: orderId,
            type: { in: [StockMovementType.SALE, StockMovementType.CANCELLATION] },
        },
        select: {
            type: true,
            productId: true,
            variantId: true,
            warehouseId: true,
            quantity: true,
        },
    });

    // Net per (product, variant, warehouse): what the sale took, less anything
    // a previous cancellation already gave back. Quantities are stored signed
    // by the writers, so compare magnitudes.
    const key = (productId: string, variantId: string | null, warehouseId: string | null) =>
        `${productId}:${variantId ?? ""}:${warehouseId ?? ""}`;

    const outstanding = new Map<
        string,
        { productId: string; variantId: string | null; warehouseId: string | null; quantity: number }
    >();

    for (const movement of movements) {
        const mapKey = key(movement.productId, movement.variantId, movement.warehouseId);
        const entry = outstanding.get(mapKey) ?? {
            productId: movement.productId,
            variantId: movement.variantId,
            warehouseId: movement.warehouseId,
            quantity: 0,
        };

        entry.quantity +=
            movement.type === StockMovementType.SALE
                ? Math.abs(movement.quantity)
                : -Math.abs(movement.quantity);

        outstanding.set(mapKey, entry);
    }

    const toRestore = [...outstanding.values()].filter((entry) => entry.quantity > 0);

    if (toRestore.length === 0) {
        return;
    }

    const newMovements: Prisma.StockMovementCreateManyInput[] = [];

    for (const entry of toRestore) {
        // A movement whose warehouse was cleared (Warehouse delete sets it
        // null) cannot be credited to a shelf. Skipped rather than guessed:
        // inventing a warehouse would move stock somewhere it never was, and
        // the report script surfaces what is left unrestored.
        if (!entry.warehouseId) continue;

        const existingStock = await tx.stock.findFirst({
            where: {
                warehouseId: entry.warehouseId,
                productId: entry.productId,
                variantId: entry.variantId,
            },
        });

        if (existingStock) {
            await tx.stock.update({
                where: { id: existingStock.id },
                data: { quantity: { increment: entry.quantity } },
            });
        } else {
            await tx.stock.create({
                data: {
                    warehouseId: entry.warehouseId,
                    productId: entry.productId,
                    variantId: entry.variantId,
                    quantity: entry.quantity,
                },
            });
        }

        newMovements.push({
            productId: entry.productId,
            variantId: entry.variantId,
            warehouseId: entry.warehouseId,
            type: StockMovementType.CANCELLATION,
            quantity: entry.quantity,
            referenceId: orderId,
        });

        await StockService.applyDenormalizedStockDelta(
            tx,
            entry.productId,
            entry.variantId,
            entry.quantity,
        );
    }

    if (newMovements.length > 0) {
        await tx.stockMovement.createMany({ data: newMovements });
    }
};

/**
 * Repairs orders created by older/non-checkout paths that reached delivery
 * without a SALE movement. Normal checkout orders already have one, so this
 * is idempotent and cannot deduct stock twice.
 */
const ensureDeliveredOrderStockDeducted = async (
    tx: Prisma.TransactionClient,
    orderId: string,
) => {
    const existingSale = await tx.stockMovement.findFirst({
        where: { referenceId: orderId, type: StockMovementType.SALE },
        select: { id: true },
    });

    if (existingSale) return;

    const items = await tx.orderItem.findMany({
        where: { orderId },
        select: {
            productId: true,
            variantId: true,
            quantity: true,
            productName: true,
        },
    });

    await deductStockForOrderLines(tx, orderId, items);
};

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

        // In the same transaction as the status change: a cancellation that
        // half-restocks leaves the ledger disagreeing with the order that
        // caused it, which is worse than the bug this fixes.
        await restockCancelledOrder(tx, orderId);

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

    // Customer-initiated, but it moves stock exactly as the staff path does —
    // so it belongs in the same trail, attributed to the customer's own user.
    await AuditLogService.record(userId, AuditAction.UPDATE, "Order", orderId, {
        oldData: order,
        newData: cancelled,
    });

    await NotificationService.createNotification(
        userId,
        NotificationType.ORDER,
        "Order cancelled",
        `Your order ${cancelled.orderNumber} has been cancelled.`,
    );

    // Customer self-cancel — staff use `updateOrderStatus` instead.
    return flattenedWithoutCosts(cancelled);
};

/**
 * `changedByUserId` is optional because not every status change has a person
 * behind it. The courier's delivery notification advances an order with no
 * operator involved, and `OrderStatusHistory.changedById` is already a nullable
 * FK to User — so the honest record is no actor, not a sentinel string, which
 * would fail the foreign key on write.
 */
const updateOrderStatus = async (
    orderId: string,
    payload: IUpdateOrderStatusPayload,
    changedByUserId?: string,
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

    assertOrderTransitionAllowed(order.status, payload.status);

    const updated = await prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id: orderId }, data: { status: payload.status } });

        if (payload.status === OrderStatus.DELIVERED) {
            await ensureDeliveredOrderStockDeducted(tx, orderId);
        }

        /*
         * Cancelling before fulfilment returns the goods to the shelf — they
         * never left. Past that they are with the courier or the customer, and
         * crediting them back would invent stock nobody has.
         *
         * This condition is now the ONLY thing preventing that: the transition
         * map used to withhold CANCELLED from SHIPPED onward, but transitions
         * are unrestricted (see ORDER_STATUS_TRANSITIONS above), so cancelling a
         * delivered order is reachable and must write the status without
         * touching stock. Goods with the customer come back through the return
         * flow, which credits stock on its own terms.
         */
        if (
            payload.status === OrderStatus.CANCELLED &&
            RESTOCKABLE_ON_CANCEL_STATUSES.includes(order.status)
        ) {
            await restockCancelledOrder(tx, orderId);
        }

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

    /*
     * A status change here can return stock to the shelf. `OrderStatusHistory`
     * already records the transition for the customer-facing timeline; this
     * records it for the admin trail, alongside every other inventory-moving
     * correction, with the before/after state a later reconciliation needs.
     */
    await AuditLogService.record(changedByUserId, AuditAction.UPDATE, "Order", orderId, {
        oldData: order,
        newData: updated,
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

    /*
     * Flattened on the way out, like every other order read. Deliberately here
     * and not before the audit record above: that log stores the database row
     * as it is, and a shape invented for a client does not belong in a trail
     * kept for reconciliation.
     *
     * Cost is NOT stripped — this path is staff-only (`checkAuth` on the route
     * admits OWNER/ADMIN/STAFF), which is exactly the audience `unitCost` is
     * for.
     */
    return flattenItemImages(updated);
};

export const OrderService = {
    placeOrder,
    placeManualOrder,
    quoteCheckout,
    getOrders,
    getOrderById,
    getGuestOrderByNumberAndPhone,
    cancelOwnOrder,
    updateOrderStatus,
    /** Exposed so the admin offers exactly the transitions this service will accept. */
    allowedOrderTransitions,
};
