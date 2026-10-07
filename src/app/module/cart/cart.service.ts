import crypto from "crypto";
import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { AuditAction, Prisma, ProductStatus } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { AuditLogService } from "../audit-log/audit-log.service";
import { CampaignService } from "../campaign/campaign.service";
import { CouponService } from "../coupon/coupon.service";
import { CustomerService } from "../customer/customer.service";
import { ABANDONED_AFTER_HOURS, EMPTY_CART_MIN_AGE_HOURS } from "./cart.constant";
import {
    IAbandonedCart,
    IAbandonedCartSummary,
    IAddCartItemPayload,
    IPurgeCartsPayload,
} from "./cart.interface";

const CART_INCLUDE = {
    items: {
        include: {
            product: {
                select: {
                    id: true,
                    name: true,
                    slug: true,
                    offerPrice: true,
                    status: true,
                    images: { where: { isPrimary: true }, take: 1 },
                },
            },
            variant: true,
        },
        orderBy: { createdAt: "asc" as const },
    },
};

const generateGuestToken = () => crypto.randomBytes(24).toString("hex");

/**
 * Get-or-create for a customer's cart, deliberately NOT `prisma.cart.upsert`.
 *
 * An upsert with an empty `update` cannot become a native
 * `INSERT … ON CONFLICT`, so Prisma emulates it: BEGIN, three SELECTs, COMMIT —
 * five round trips to find a cart that almost always already exists. Every
 * database call here used to cross to Neon in ap-southeast-1, so on a logged-in cart
 * request that emulation alone cost more than the rest of the operation.
 *
 * `find` runs first and is the whole cost in the common case. When two first
 * requests race to create, `Cart.customerId` is unique, so the loser's insert
 * fails with P2002 and it reads back the winner's row rather than erroring.
 */
const findOrCreateCart = async <T>(
    find: () => Promise<T | null>,
    create: () => Promise<T>,
): Promise<T> => {
    const existing = await find();
    if (existing) return existing;

    try {
        return await create();
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            const winner = await find();
            if (winner) return winner;
        }
        throw error;
    }
};

/**
 * Resolves the cart for this request: the customer's cart when logged in
 * (get-or-create, lazily creating the Customer row too if this is their
 * first storefront action), otherwise the guest cart identified by
 * `guestTokenCookie` — minting a fresh guest cart+token if neither a
 * session nor a valid guest cookie is present. Per `api/cart-wishlist`
 * spec, a cart operation without a session falls back to guest behavior
 * instead of failing.
 *
 * The logged-in branch looks the cart up THROUGH `customer.userId` — one query
 * — and only resolves (or lazily creates) the Customer row when there is no
 * cart yet, instead of always reading the customer first and the cart second.
 */
const resolveCart = async (userId: string | undefined, guestTokenCookie: string | undefined) => {
    if (userId) {
        const owned = await prisma.cart.findFirst({
            where: { customer: { is: { userId } } },
            include: CART_INCLUDE,
        });
        if (owned) {
            return { cart: owned, customerId: owned.customerId ?? undefined };
        }

        const customer = await CustomerService.getOrCreateCustomerByUserId(userId);
        const cart = await findOrCreateCart(
            () => prisma.cart.findUnique({ where: { customerId: customer.id }, include: CART_INCLUDE }),
            () => prisma.cart.create({ data: { customerId: customer.id }, include: CART_INCLUDE }),
        );
        return { cart, customerId: customer.id };
    }

    if (guestTokenCookie) {
        const existing = await prisma.cart.findUnique({
            where: { guestToken: guestTokenCookie },
            include: CART_INCLUDE,
        });
        if (existing) {
            return { cart: existing, customerId: undefined };
        }
    }

    const guestToken = generateGuestToken();
    const cart = await prisma.cart.create({
        data: { guestToken },
        include: CART_INCLUDE,
    });
    return { cart, newGuestToken: guestToken, customerId: undefined };
};

/**
 * The same resolution as `resolveCart`, minus the `CART_INCLUDE` payload.
 * Mutations only ever need `cart.id` — they call `reloadCart` afterwards for
 * the full cart anyway — so fetching every item, product, image and variant
 * up front is work that gets thrown away on every add/update/remove.
 */
const resolveCartId = async (userId: string | undefined, guestTokenCookie: string | undefined) => {
    if (userId) {
        const owned = await prisma.cart.findFirst({
            where: { customer: { is: { userId } } },
            select: { id: true, customerId: true },
        });
        if (owned) {
            return { cartId: owned.id, customerId: owned.customerId ?? undefined };
        }

        const customer = await CustomerService.getOrCreateCustomerByUserId(userId);
        const cart = await findOrCreateCart(
            () => prisma.cart.findUnique({ where: { customerId: customer.id }, select: { id: true } }),
            () => prisma.cart.create({ data: { customerId: customer.id }, select: { id: true } }),
        );
        return { cartId: cart.id, customerId: customer.id };
    }

    if (guestTokenCookie) {
        const existing = await prisma.cart.findUnique({
            where: { guestToken: guestTokenCookie },
            select: { id: true },
        });
        if (existing) {
            return { cartId: existing.id, customerId: undefined };
        }
    }

    const guestToken = generateGuestToken();
    const cart = await prisma.cart.create({
        data: { guestToken },
        select: { id: true },
    });
    return { cartId: cart.id, customerId: undefined, newGuestToken: guestToken };
};

/**
 * Attaches each line's `effectiveUnitPrice` — what that unit will actually be
 * charged, once any active campaign is applied.
 *
 * The cart deliberately returns no other monetary field: the storefront
 * derives every total from the catalogue prices on each row. That worked only
 * while the price a shopper is charged WAS `offerPrice`. Campaign pricing
 * broke it — the cart page, the drawer and the pre-quote checkout summary all
 * multiplied out `offerPrice` and showed a subtotal the order then undercut.
 *
 * So the effective price is resolved here, server side, rather than teaching
 * each of those surfaces about campaigns: they all read one field, and the
 * charged figure comes from `CampaignService` either way, so the cart cannot
 * drift from checkout without the two disagreeing about the same call.
 *
 * `offerPrice` is left on the row untouched — it is the struck-through
 * comparison the cart shows next to a discounted line.
 */
const withEffectivePrices = async <
    T extends {
        productId: string;
        variantId: string | null;
        product: { offerPrice: unknown };
        variant: { offerPrice: unknown } | null;
    },
>(
    items: T[],
) => {
    const campaignPriceByKey = await CampaignService.getActiveDiscountsForLines(
        items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId,
            unitPrice: Number(item.variant?.offerPrice ?? item.product.offerPrice),
        })),
    );

    return items.map((item) => {
        const listPrice = Number(item.variant?.offerPrice ?? item.product.offerPrice);
        const campaignPrice = campaignPriceByKey.get(`${item.productId}:${item.variantId ?? ""}`);

        return {
            ...item,
            effectiveUnitPrice: campaignPrice ?? listPrice,
            /** Null unless a campaign is cutting this line's price. */
            campaignUnitPrice: campaignPrice ?? null,
        };
    });
};

/**
 * `appliedCouponCode` (read from the `appliedCoupon` cookie by
 * cart.controller.ts) is re-validated against the current cart on every
 * fetch so the discount preview never shows a stale/no-longer-applicable
 * coupon — see `CouponService.getAppliedDiscountForCart`. `discount` is
 * `null` when no coupon is applied or it's no longer valid; the controller
 * clears the cookie in the latter case.
 */
const getCart = async (
    userId: string | undefined,
    guestTokenCookie: string | undefined,
    appliedCouponCode?: string,
) => {
    const { cart, newGuestToken, customerId } = await resolveCart(userId, guestTokenCookie);

    const [items, discount] = await Promise.all([
        withEffectivePrices(cart.items),
        CouponService.getAppliedDiscountForCart(cart.items, customerId, appliedCouponCode),
    ]);

    return { cart: { ...cart, items }, newGuestToken, discount };
};

/**
 * The post-mutation cart, shaped exactly like `getCart`'s — items *and* the
 * re-validated `discount`. Clients render a cart straight from a mutation
 * response rather than following it with a read, so anything `getCart`
 * returns has to be here too; omitting `discount` would silently drop an
 * applied coupon from the UI until the next full fetch.
 *
 * The one thing this deliberately does not do is `getCart`'s cookie
 * clearing when a coupon has stopped applying — a mutation has no business
 * mutating the coupon cookie. The next cart read reconciles it.
 */
const reloadCart = async (
    cartId: string,
    customerId: string | undefined,
    appliedCouponCode?: string,
) => {
    // The cart row and its items in parallel rather than `include`, which reads
    // the cart first and only then starts on the items — one extra round trip
    // for a row whose only unknown is its timestamps.
    const [cartRow, cartItems] = await Promise.all([
        prisma.cart.findUniqueOrThrow({ where: { id: cartId } }),
        prisma.cartItem.findMany({ where: { cartId }, ...CART_INCLUDE.items }),
    ]);
    const cart = { ...cartRow, items: cartItems };

    const [items, discount] = await Promise.all([
        withEffectivePrices(cart.items),
        CouponService.getAppliedDiscountForCart(cart.items, customerId, appliedCouponCode),
    ]);

    return { ...cart, items, discount };
};

const addItem = async (
    userId: string | undefined,
    guestTokenCookie: string | undefined,
    payload: IAddCartItemPayload,
    appliedCouponCode?: string,
) => {
    /*
     * The line this add would merge into is looked up alongside everything
     * else, through the same identity `resolveCartId` resolves by — the
     * session's customer first, else the guest token. It cannot be keyed by
     * `cartId` here because that is not known yet.
     *
     * The `cartId` comparison below is what makes that safe: a line from any
     * cart other than the one resolved is ignored rather than trusted. With no
     * identity at all the lookup is skipped — `guestToken: undefined` would
     * be no filter, matching a line in SOMEONE ELSE'S cart — and a freshly
     * minted cart has no lines anyway.
     */
    const cartOwner: Prisma.CartWhereInput | null = userId
        ? { customer: { is: { userId } } }
        : guestTokenCookie
          ? { guestToken: guestTokenCookie }
          : null;

    // Independent of each other: which cart this is has no bearing on whether
    // the product exists, so they resolve concurrently rather than in series.
    const [{ cartId, customerId, newGuestToken }, product, variant, matchingItem] =
        await Promise.all([
            resolveCartId(userId, guestTokenCookie),
            prisma.product.findUnique({ where: { id: payload.productId } }),
            payload.variantId
                ? prisma.productVariant.findUnique({ where: { id: payload.variantId } })
                : Promise.resolve(null),
            cartOwner
                ? prisma.cartItem.findFirst({
                      where: {
                          cart: { is: cartOwner },
                          productId: payload.productId,
                          variantId: payload.variantId ?? null,
                      },
                      select: { id: true, cartId: true },
                  })
                : Promise.resolve(null),
        ]);

    if (!product || product.status !== ProductStatus.ACTIVE) {
        throw new AppError(status.NOT_FOUND, "Product not found");
    }

    if (payload.variantId && (!variant || variant.productId !== payload.productId)) {
        throw new AppError(status.BAD_REQUEST, "Variant does not belong to this product");
    }

    const quantityToAdd = payload.quantity ?? 1;

    // find-or-increment: an explicit lookup, not a blind insert relying on
    // the DB unique constraint — MySQL treats NULL as distinct in unique
    // indexes, so two rows with the same cartId+productId and variantId
    // NULL would NOT collide there (see CartItem.prisma).
    const existingItem = matchingItem?.cartId === cartId ? matchingItem : null;

    if (existingItem) {
        // `increment`, not a quantity read earlier plus one: the database adds
        // to whatever the row holds NOW, so two quick clicks both count.
        await prisma.cartItem.update({
            where: { id: existingItem.id },
            data: { quantity: { increment: quantityToAdd } },
        });
    } else {
        await prisma.cartItem.create({
            data: {
                cartId,
                productId: payload.productId,
                variantId: payload.variantId,
                quantity: quantityToAdd,
            },
        });
    }

    return { cart: await reloadCart(cartId, customerId, appliedCouponCode), newGuestToken };
};

const updateItemQuantity = async (
    userId: string | undefined,
    guestTokenCookie: string | undefined,
    itemId: string,
    quantity: number,
    appliedCouponCode?: string,
) => {
    const [{ cartId, customerId, newGuestToken }, item] = await Promise.all([
        resolveCartId(userId, guestTokenCookie),
        prisma.cartItem.findUnique({ where: { id: itemId } }),
    ]);

    if (!item || item.cartId !== cartId) {
        throw new AppError(status.NOT_FOUND, "Cart item not found");
    }

    await prisma.cartItem.update({ where: { id: itemId }, data: { quantity } });

    return { cart: await reloadCart(cartId, customerId, appliedCouponCode), newGuestToken };
};

const removeItem = async (
    userId: string | undefined,
    guestTokenCookie: string | undefined,
    itemId: string,
    appliedCouponCode?: string,
) => {
    const [{ cartId, customerId, newGuestToken }, item] = await Promise.all([
        resolveCartId(userId, guestTokenCookie),
        prisma.cartItem.findUnique({ where: { id: itemId } }),
    ]);

    if (!item || item.cartId !== cartId) {
        throw new AppError(status.NOT_FOUND, "Cart item not found");
    }

    await prisma.cartItem.delete({ where: { id: itemId } });

    return { cart: await reloadCart(cartId, customerId, appliedCouponCode), newGuestToken };
};

/**
 * Merges a guest cart into the customer's cart on login (per
 * `api/cart-wishlist` spec: quantities combine on matching product/variant,
 * and the guest cart stops being reachable by its former token). No-op if
 * the guest token doesn't resolve to a cart (e.g. already merged/expired).
 */
const mergeGuestCartIntoCustomerCart = async (customerId: string, guestToken: string) => {
    const guestCart = await prisma.cart.findUnique({
        where: { guestToken },
        include: { items: true },
    });

    if (!guestCart) {
        return;
    }

    if (guestCart.items.length === 0) {
        await prisma.cart.delete({ where: { id: guestCart.id } });
        return;
    }

    const customerCart = await findOrCreateCart(
        () => prisma.cart.findUnique({ where: { customerId }, select: { id: true } }),
        () => prisma.cart.create({ data: { customerId }, select: { id: true } }),
    );

    await prisma.$transaction(async (tx) => {
        for (const guestItem of guestCart.items) {
            const existing = await tx.cartItem.findFirst({
                where: {
                    cartId: customerCart.id,
                    productId: guestItem.productId,
                    variantId: guestItem.variantId ?? null,
                },
            });

            if (existing) {
                await tx.cartItem.update({
                    where: { id: existing.id },
                    data: { quantity: existing.quantity + guestItem.quantity },
                });
            } else {
                await tx.cartItem.create({
                    data: {
                        cartId: customerCart.id,
                        productId: guestItem.productId,
                        variantId: guestItem.variantId,
                        quantity: guestItem.quantity,
                    },
                });
            }
        }

        // Cascades the guest cart's CartItems (Cart -> CartItem onDelete:
        // Cascade) and frees the guestToken so it stops resolving to a cart.
        await tx.cart.delete({ where: { id: guestCart.id } });
    });
};

/* ------------------------------------------------------------------------ *
 * Abandoned carts — the admin's view of carts shoppers filled and left.
 * See openspec/changes/add-abandoned-carts-admin.
 * ------------------------------------------------------------------------ */

const HOUR_MS = 60 * 60 * 1000;

const abandonedCutoff = () => new Date(Date.now() - ABANDONED_AFTER_HOURS * HOUR_MS);

/**
 * "Holds items, and none was added or changed since `cutoff`." Measured on the
 * ITEMS: `Cart.updatedAt` does not move when items change, so filtering on it
 * would call a cart abandoned while its shopper was still filling it. The raw
 * list query in `getAbandonedCarts` states the same rule as
 * `MAX(updatedAt) <= cutoff`; the two must stay equivalent. Design.md Decision 1.
 */
const abandonedWhere = (cutoff: Date): Prisma.CartWhereInput => ({
    items: { some: {}, none: { updatedAt: { gt: cutoff } } },
});

/** Money in cents, so a sum of lines cannot drift a paisa from its parts. */
const toCents = (value: number) => Math.round(value * 100);

/**
 * What an admin may see of a cart. `guestToken` is deliberately ABSENT: it is
 * the credential that opens a guest's cart, and this screen has no use for it.
 */
const ABANDONED_CART_SELECT = {
    id: true,
    customerId: true,
    customer: { select: { firstName: true, lastName: true, email: true, phone: true } },
    items: {
        select: {
            productId: true,
            variantId: true,
            quantity: true,
            product: { select: { name: true, offerPrice: true } },
            variant: { select: { name: true, offerPrice: true } },
        },
        orderBy: { createdAt: "asc" as const },
    },
} satisfies Prisma.CartSelect;

/**
 * One page of abandoned carts, most recent activity first, valued at what the
 * shopper would be charged now — campaign prices included, through the same
 * `withEffectivePrices` their own cart uses, so the two never disagree.
 *
 * Ordered in SQL because "newest item first" is an aggregate over a relation,
 * which Prisma's `orderBy` cannot express; the page's carts are then loaded
 * through Prisma and put back in that order. `cartId` breaks ties so paging is
 * stable. Design.md Decisions 2 and 3.
 */
const getAbandonedCarts = async ({ page, limit }: { page: number; limit: number }) => {
    const cutoff = abandonedCutoff();
    const skip = (page - 1) * limit;

    const [pageRows, totals] = await Promise.all([
        prisma.$queryRaw<{ cartId: string; lastActivityAt: Date }[]>`
            SELECT ci.cartId AS cartId, MAX(ci.updatedAt) AS lastActivityAt
            FROM CartItem ci
            GROUP BY ci.cartId
            HAVING MAX(ci.updatedAt) <= ${cutoff}
            ORDER BY lastActivityAt DESC, ci.cartId ASC
            LIMIT ${limit} OFFSET ${skip}
        `,
        prisma.$queryRaw<{ total: bigint | number }[]>`
            SELECT COUNT(*) AS total
            FROM (
                SELECT ci.cartId
                FROM CartItem ci
                GROUP BY ci.cartId
                HAVING MAX(ci.updatedAt) <= ${cutoff}
            ) abandoned
        `,
    ]);

    const total = Number(totals[0]?.total ?? 0);
    const meta = { page, limit, total, totalPages: Math.ceil(total / limit) };
    if (pageRows.length === 0) return { data: [] as IAbandonedCart[], meta };

    const carts = await prisma.cart.findMany({
        where: { id: { in: pageRows.map((row) => row.cartId) } },
        select: ABANDONED_CART_SELECT,
    });

    // One campaign lookup for the whole page, not one per cart.
    const priced = await withEffectivePrices(
        carts.flatMap((cart) => cart.items.map((item) => ({ ...item, cartId: cart.id }))),
    );

    const cartsById = new Map(carts.map((cart) => [cart.id, cart]));
    const data: IAbandonedCart[] = [];

    for (const row of pageRows) {
        const cart = cartsById.get(row.cartId);
        // Deleted between the two queries — simply not on this page.
        if (!cart) continue;

        const items = priced
            .filter((item) => item.cartId === cart.id)
            .map((item) => {
                const unitCents = toCents(item.effectiveUnitPrice);
                return {
                    productId: item.productId,
                    variantId: item.variantId,
                    name: item.product.name,
                    variantName: item.variant?.name ?? null,
                    quantity: item.quantity,
                    unitPrice: unitCents / 100,
                    lineTotal: (unitCents * item.quantity) / 100,
                };
            });

        data.push({
            id: cart.id,
            isGuest: cart.customerId === null,
            customer: cart.customer
                ? {
                      name: [cart.customer.firstName, cart.customer.lastName]
                          .filter(Boolean)
                          .join(" "),
                      phone: cart.customer.phone,
                      email: cart.customer.email,
                  }
                : null,
            items,
            itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
            total: items.reduce((sum, item) => sum + toCents(item.lineTotal), 0) / 100,
            lastActivityAt: new Date(row.lastActivityAt).toISOString(),
        });
    }

    return { data, meta };
};

/**
 * How many carts are abandoned, split by owner, and what they are worth.
 *
 * The value is priced item by item through `withEffectivePrices`, like the
 * list, rather than summed in SQL from `offerPrice`: a SQL sum would ignore
 * campaigns and disagree with the rows beneath it. That means loading every
 * abandoned item — bounded by real abandoned volume, which purging keeps down.
 * Design.md Decision 3.
 */
const getAbandonedCartSummary = async (): Promise<IAbandonedCartSummary> => {
    const where = abandonedWhere(abandonedCutoff());

    const [total, guest, items] = await Promise.all([
        prisma.cart.count({ where }),
        prisma.cart.count({ where: { ...where, customerId: null } }),
        prisma.cartItem.findMany({
            where: { cart: where },
            select: {
                productId: true,
                variantId: true,
                quantity: true,
                product: { select: { offerPrice: true } },
                variant: { select: { offerPrice: true } },
            },
        }),
    ]);

    const priced = await withEffectivePrices(items);
    const valueCents = priced.reduce(
        (sum, item) => sum + toCents(item.effectiveUnitPrice) * item.quantity,
        0,
    );

    return { total, customer: total - guest, guest, value: valueCents / 100 };
};

/**
 * Deletes the chosen carts; their items go with them by the database cascade.
 * Ids that no longer exist are ignored, so a repeated or concurrent delete
 * settles instead of failing. The audit record names the carts that were
 * actually there. A shopper whose cart is deleted simply gets a new empty one
 * on their next request (`resolveCart`). Design.md Decisions 5 and 6.
 */
const deleteCarts = async (userId: string, ids: string[]) => {
    const existing = await prisma.cart.findMany({
        where: { id: { in: ids } },
        select: { id: true },
    });
    const existingIds = existing.map((cart) => cart.id);

    const { count } = await prisma.cart.deleteMany({ where: { id: { in: existingIds } } });

    await AuditLogService.record(userId, AuditAction.DELETE, "Cart", undefined, {
        oldData: { ids: existingIds, deleted: count },
    });

    return { deleted: count };
};

/**
 * The purge rules as `where` clauses, exported so `verify-abandoned-carts.ts`
 * can exercise EXACTLY these rules restricted to its own `__verify_` carts. The
 * verify scripts run against the real database, where an unscoped purge would
 * delete real shoppers' carts.
 */
export const CART_PURGE_RULES = {
    guest: (olderThanDays: number): Prisma.CartWhereInput => {
        const cutoff = new Date(Date.now() - olderThanDays * 24 * HOUR_MS);
        return {
            guestToken: { not: null },
            createdAt: { lt: cutoff },
            items: { none: { updatedAt: { gt: cutoff } } },
        };
    },
    empty: (): Prisma.CartWhereInput => ({
        items: { none: {} },
        createdAt: { lt: new Date(Date.now() - EMPTY_CART_MIN_AGE_HOURS * HOUR_MS) },
    }),
};

/**
 * The two bulk clean-ups, each one `deleteMany` whose `where` IS the rule, so
 * "no recent item" is judged when the row is deleted rather than in an earlier
 * read — a shopper adding an item mid-purge either lands first and keeps the
 * cart, or lands after and gets a fresh one.
 *
 * Neither rule can reach a customer's cart that still holds items: the guest
 * rule requires a `guestToken`, the empty rule requires no items. That is the
 * guarantee the spec states, held by construction rather than by a check.
 *
 * Guest rule: `createdAt` older than the cutoff is what makes an EMPTY guest
 * cart count from its creation; for a cart with items it is implied, since no
 * item is older than its cart. Design.md Decision 5.
 */
const purgeCarts = async (userId: string, payload: IPurgeCartsPayload) => {
    const removed = { guest: 0, empty: 0 };

    if (payload.guestOlderThanDays) {
        const { count } = await prisma.cart.deleteMany({
            where: CART_PURGE_RULES.guest(payload.guestOlderThanDays),
        });
        removed.guest = count;
    }

    if (payload.emptyCarts) {
        const { count } = await prisma.cart.deleteMany({ where: CART_PURGE_RULES.empty() });
        removed.empty = count;
    }

    // Criteria and counts, not ids: a first purge on a long-running shop can
    // remove thousands of rows. Design.md Decision 6.
    await AuditLogService.record(userId, AuditAction.DELETE, "Cart", undefined, {
        oldData: {
            rules: {
                guestOlderThanDays: payload.guestOlderThanDays ?? null,
                emptyCarts: payload.emptyCarts ?? false,
            },
            removed,
        },
    });

    return removed;
};

export const CartService = {
    getCart,
    addItem,
    updateItemQuantity,
    removeItem,
    mergeGuestCartIntoCustomerCart,
    getAbandonedCarts,
    getAbandonedCartSummary,
    deleteCarts,
    purgeCarts,
};
