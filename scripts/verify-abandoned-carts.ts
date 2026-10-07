/**
 * Verification for the admin's abandoned-cart view and clean-up.
 *
 * The properties under test are the ones whose failure would look plausible:
 *
 *  - "abandoned" is judged on the ITEMS, so an old cart still being filled is
 *    not listed and an empty cart never is;
 *  - a guest cart's token never leaves the API;
 *  - a cart is valued at what the shopper would be charged, campaign included;
 *  - the summary agrees with the list it sits above;
 *  - deleting settles on ids that are already gone, and is audited by id;
 *  - neither purge rule can reach a customer's cart that still holds items.
 *
 * THE PURGE RULES ARE EXERCISED SCOPED TO THIS SCRIPT'S OWN CARTS, through the
 * same `CART_PURGE_RULES` `purgeCarts` uses. These scripts run against the real
 * database, where an unscoped purge would delete real shoppers' carts — so
 * `purgeCarts` itself (and its audit record) is not called here.
 *
 * See openspec/changes/add-abandoned-carts-admin.
 *
 * Imports the services directly — no HTTP — per the repo's testing approach.
 * Creates `__verify_*`-prefixed rows and removes them in a `finally`.
 *
 * Run with:
 *   npx tsx scripts/verify-abandoned-carts.ts
 */
import { AuditAction, CampaignStatus, DiscountType, ProductStatus } from "../src/generated/prisma/client";
import { RoleId } from "../src/app/constants/role.constant";
import { prisma } from "../src/app/lib/prisma";
import { CART_PURGE_RULES, CartService } from "../src/app/module/cart/cart.service";
import type { IAbandonedCart } from "../src/app/module/cart/cart.interface";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

const PREFIX = "__verify_abandoned_";
const HOUR = 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms);
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

/** Every abandoned cart, across all pages — the list as an admin would page through it. */
const listAll = async () => {
    const all: IAbandonedCart[] = [];
    for (let page = 1; ; page += 1) {
        const { data, meta } = await CartService.getAbandonedCarts({ page, limit: 50 });
        all.push(...data);
        if (page >= meta.totalPages) return all;
    }
};

const main = async () => {
    const category = await prisma.category.findFirst({ select: { id: true } });
    if (!category) {
        console.log("No category exists; cannot create probe products. Skipping.");
        return;
    }

    const cartIds: string[] = [];

    try {
        /* --------------------------------------------------------------- *
         * Fixtures
         * --------------------------------------------------------------- */
        const user = await prisma.user.create({
            data: {
                id: `${PREFIX}user`,
                name: `${PREFIX}user`,
                email: `${PREFIX}user@example.test`,
                roleId: RoleId.OWNER,
            },
            select: { id: true },
        });

        const customer = await prisma.customer.create({
            data: { firstName: `${PREFIX}Rahim`, lastName: "Uddin" },
            select: { id: true },
        });

        const plain = await prisma.product.create({
            data: {
                name: `${PREFIX}plain`,
                slug: `${PREFIX}plain`,
                sku: `${PREFIX}PLAIN`,
                categoryId: category.id,
                status: ProductStatus.ACTIVE,
                offerPrice: 1000,
                sellingPrice: 1200,
            },
            select: { id: true },
        });

        const onCampaign = await prisma.product.create({
            data: {
                name: `${PREFIX}campaign`,
                slug: `${PREFIX}campaign`,
                sku: `${PREFIX}CAMPAIGN`,
                categoryId: category.id,
                status: ProductStatus.ACTIVE,
                offerPrice: 500,
                sellingPrice: 600,
            },
            select: { id: true },
        });

        await prisma.campaign.create({
            data: {
                name: `${PREFIX}20pct`,
                status: CampaignStatus.ACTIVE,
                startsAt: ago(60_000),
                endsAt: new Date(Date.now() + HOUR),
                products: {
                    create: [
                        { productId: onCampaign.id, discountType: DiscountType.PERCENTAGE, discountValue: 20 },
                    ],
                },
            },
        });

        /** A cart with one item whose last activity is `itemAge` ago. */
        const makeCart = async (opts: {
            guest: boolean;
            createdAge: number;
            item?: { productId: string; quantity: number; age: number };
        }) => {
            const cart = await prisma.cart.create({
                data: {
                    ...(opts.guest
                        ? { guestToken: `${PREFIX}${cartIds.length}_${Date.now()}` }
                        : { customerId: customer.id }),
                    createdAt: ago(opts.createdAge),
                },
                select: { id: true },
            });
            cartIds.push(cart.id);
            if (opts.item) {
                await prisma.cartItem.create({
                    data: {
                        cartId: cart.id,
                        productId: opts.item.productId,
                        quantity: opts.item.quantity,
                        createdAt: ago(opts.item.age),
                        updatedAt: ago(opts.item.age),
                    },
                });
            }
            return cart.id;
        };

        // A customer may own only one cart, so the customer cart is reused.
        const leftByGuest = await makeCart({
            guest: true,
            createdAge: 30 * HOUR,
            item: { productId: plain.id, quantity: 2, age: 25 * HOUR },
        });
        const stillFilling = await makeCart({
            guest: true,
            createdAge: 7 * 24 * HOUR,
            item: { productId: plain.id, quantity: 1, age: 1 * HOUR },
        });
        const emptyOld = await makeCart({ guest: true, createdAge: 7 * 24 * HOUR });
        const leftByCustomer = await makeCart({
            guest: false,
            createdAge: 30 * HOUR,
            item: { productId: onCampaign.id, quantity: 1, age: 25 * HOUR },
        });

        /* --------------------------------------------------------------- *
         * The list
         * --------------------------------------------------------------- */
        const listed = await listAll();
        const byId = new Map(listed.map((cart) => [cart.id, cart]));

        const guestRow = byId.get(leftByGuest);
        check(
            "cart idle 25h is listed",
            Boolean(guestRow),
            guestRow ? "listed" : "NOT listed",
        );
        check(
            "old cart with a 1h-old item is not listed",
            !byId.has(stillFilling),
            byId.has(stillFilling) ? "LISTED — judged on the cart, not its items" : "not listed",
        );
        check("empty cart is not listed", !byId.has(emptyOld), byId.has(emptyOld) ? "LISTED" : "not listed");
        check(
            "no listed cart carries a guest token",
            listed.every((cart) => !("guestToken" in cart)),
            "checked every row",
        );
        check(
            "guest cart is marked guest and valued 2 × 1000",
            Boolean(guestRow?.isGuest) && near(guestRow?.total ?? -1, 2000),
            `isGuest=${guestRow?.isGuest}, total=${guestRow?.total}`,
        );

        const customerRow = byId.get(leftByCustomer);
        check(
            "customer cart names its owner",
            customerRow?.customer?.name === `${PREFIX}Rahim Uddin` && customerRow.isGuest === false,
            `customer=${JSON.stringify(customerRow?.customer)}`,
        );
        check(
            "campaign item is valued at the campaign price (500 − 20%)",
            near(customerRow?.items[0]?.unitPrice ?? -1, 400) && near(customerRow?.total ?? -1, 400),
            `unit=${customerRow?.items[0]?.unitPrice}, total=${customerRow?.total}`,
        );

        const sorted = listed.every(
            (cart, index) => index === 0 || listed[index - 1].lastActivityAt >= cart.lastActivityAt,
        );
        check("list is newest activity first", sorted, `${listed.length} row(s) checked`);

        /* --------------------------------------------------------------- *
         * The summary agrees with the list
         * --------------------------------------------------------------- */
        const summary = await CartService.getAbandonedCartSummary();
        const listedValue = listed.reduce((sum, cart) => sum + Math.round(cart.total * 100), 0) / 100;
        const listedGuests = listed.filter((cart) => cart.isGuest).length;
        check(
            "summary count matches the list",
            summary.total === listed.length && summary.guest === listedGuests,
            `summary ${summary.total} (${summary.guest} guest), list ${listed.length} (${listedGuests} guest)`,
        );
        check(
            "summary value matches the list",
            near(summary.value, listedValue),
            `summary ${summary.value}, list ${listedValue}`,
        );

        /* --------------------------------------------------------------- *
         * Delete
         * --------------------------------------------------------------- */
        const doomedA = await makeCart({
            guest: true,
            createdAge: 2 * HOUR,
            item: { productId: plain.id, quantity: 1, age: HOUR },
        });
        const doomedB = await makeCart({ guest: true, createdAge: 2 * HOUR });

        const result = await CartService.deleteCarts(user.id, [doomedA, doomedB, `${PREFIX}missing`]);
        const leftover = await prisma.cart.count({ where: { id: { in: [doomedA, doomedB] } } });
        const orphanItems = await prisma.cartItem.count({ where: { cartId: doomedA } });
        check(
            "delete removes carts and items, counting only those that existed",
            result.deleted === 2 && leftover === 0 && orphanItems === 0,
            `deleted=${result.deleted}, carts left=${leftover}, items left=${orphanItems}`,
        );

        const receipt = await prisma.auditLog.findFirst({
            where: { userId: user.id, action: AuditAction.DELETE, entity: "Cart" },
            orderBy: { createdAt: "desc" },
        });
        const receiptIds = JSON.stringify(receipt?.oldData ?? null);
        check(
            "delete is audited with the cart ids",
            Boolean(receipt) && receiptIds.includes(doomedA) && receiptIds.includes(doomedB),
            receipt ? `record ${receipt.id}` : "NO audit record",
        );

        /* --------------------------------------------------------------- *
         * Purge rules, scoped to this script's carts
         * --------------------------------------------------------------- */
        // Swap the customer's abandoned cart for a 31-day-old one with an item.
        await prisma.cart.delete({ where: { id: leftByCustomer } });
        cartIds.splice(cartIds.indexOf(leftByCustomer), 1);

        const oldGuest = await makeCart({
            guest: true,
            createdAge: 31 * 24 * HOUR,
            item: { productId: plain.id, quantity: 1, age: 31 * 24 * HOUR },
        });
        const oldCustomer = await makeCart({
            guest: false,
            createdAge: 31 * 24 * HOUR,
            item: { productId: plain.id, quantity: 1, age: 31 * 24 * HOUR },
        });
        const youngGuest = await makeCart({
            guest: true,
            createdAge: 24 * HOUR,
            item: { productId: plain.id, quantity: 1, age: 24 * HOUR },
        });
        const emptyTwoDays = await makeCart({ guest: true, createdAge: 48 * HOUR });
        const emptyOneHour = await makeCart({ guest: true, createdAge: HOUR });

        const mine = { id: { in: [...cartIds] } };
        const purgedGuest = await prisma.cart.deleteMany({
            where: { AND: [CART_PURGE_RULES.guest(30), mine] },
        });
        const survivors = new Set(
            (await prisma.cart.findMany({ where: mine, select: { id: true } })).map((cart) => cart.id),
        );
        check(
            "guest purge (30 days) removes a 31-day-old guest cart",
            !survivors.has(oldGuest),
            `removed ${purgedGuest.count}`,
        );
        check(
            "guest purge never removes a customer's cart with items",
            survivors.has(oldCustomer),
            survivors.has(oldCustomer) ? "kept" : "REMOVED",
        );
        check(
            "guest purge keeps a 1-day-old guest cart",
            survivors.has(youngGuest),
            survivors.has(youngGuest) ? "kept" : "REMOVED",
        );

        await prisma.cart.deleteMany({ where: { AND: [CART_PURGE_RULES.empty(), mine] } });
        const afterEmpty = new Set(
            (await prisma.cart.findMany({ where: mine, select: { id: true } })).map((cart) => cart.id),
        );
        check(
            "empty purge removes a 2-day-old empty cart",
            !afterEmpty.has(emptyTwoDays),
            afterEmpty.has(emptyTwoDays) ? "KEPT" : "removed",
        );
        check(
            "empty purge keeps a 1-hour-old empty cart",
            afterEmpty.has(emptyOneHour),
            afterEmpty.has(emptyOneHour) ? "kept" : "REMOVED",
        );
        check(
            "empty purge never removes a cart holding items",
            afterEmpty.has(oldCustomer) && afterEmpty.has(youngGuest),
            "carts with items kept",
        );

        console.log(
            "SKIP  purgeCarts' own audit record — calling it would purge real carts in this database.",
        );
    } finally {
        await prisma.cart.deleteMany({ where: { id: { in: cartIds } } });
        await prisma.customer.deleteMany({ where: { firstName: { startsWith: PREFIX } } });
        await prisma.campaign.deleteMany({ where: { name: { startsWith: PREFIX } } });
        await prisma.product.deleteMany({ where: { name: { startsWith: PREFIX } } });
        await prisma.auditLog.deleteMany({ where: { userId: `${PREFIX}user` } });
        await prisma.user.deleteMany({ where: { id: `${PREFIX}user` } });
    }
};

main()
    .then(() => {
        console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
        process.exit(failures === 0 ? 0 : 1);
    })
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
