/**
 * The cart's behaviour, and how many database round trips it costs.
 *
 * Every Prisma call from this API crosses to Neon in ap-southeast-1, so a cart
 * request's latency is roughly (round trips × distance to the database). This
 * script pins down the behaviour that the round-trip reductions in
 * cart.service.ts must not change, then prints the query count and wall time
 * of the two adds a shopper actually makes — so a regression in either shows
 * up here rather than as a slow button.
 *
 * Covered:
 *   - a guest's first add mints a cart; a repeat add merges into the same line
 *   - two adds racing on one line both count (atomic increment)
 *   - an unknown guest token gets a NEW cart, never another shopper's line
 *   - update and remove still resolve through the same cart
 *   - a logged-in customer's first add lazily creates Customer + Cart, and two
 *     first requests racing to create the cart converge on ONE cart
 *   - logging in merges the guest cart's quantities into the customer's
 *
 * Runs against the live database. Everything it creates — guest carts, two
 * throwaway users and their customers — is deleted in the finally.
 *
 * Run with: npx tsx scripts/verify-cart.ts
 */
import crypto from "crypto";
import pg from "pg";

/*
 * Counts queries at the driver, below Prisma, so an emulated upsert's BEGIN and
 * COMMIT are counted like any other round trip. `pg`'s pool calls
 * `client.query` with a callback, not a promise, so both forms are wrapped.
 */
let queryCount = 0;
const originalQuery = pg.Client.prototype.query as (...args: unknown[]) => unknown;
(pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown }).query = function (
    this: pg.Client,
    ...args: unknown[]
) {
    queryCount += 1;
    return originalQuery.apply(this, args);
};

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

const measure = async <T>(fn: () => Promise<T>) => {
    queryCount = 0;
    const start = performance.now();
    const result = await fn();
    return { result, queries: queryCount, ms: Math.round(performance.now() - start) };
};

const main = async () => {
    // Imported after the driver is patched, so the pool Prisma builds uses it.
    const { prisma } = await import("../src/app/lib/prisma");
    const { CartService } = await import("../src/app/module/cart/cart.service");

    const guestTokens: string[] = [];
    const userIds: string[] = [];

    const tempUser = async () => {
        const id = `zzverify-cart-${crypto.randomUUID()}`;
        await prisma.user.create({ data: { id, name: "Zz Verify Cart", email: `${id}@verify.test` } });
        userIds.push(id);
        return id;
    };

    try {
        const product = await prisma.product.findFirst({
            where: { status: "ACTIVE", type: "SIMPLE" },
            select: { id: true },
        });
        if (!product) throw new Error("Needs at least one ACTIVE SIMPLE product");
        const productId = product.id;

        const lineOf = (cart: { items: { productId: string; quantity: number }[] }) =>
            cart.items.filter((item) => item.productId === productId);

        // --- Guest ---

        const first = await CartService.addItem(undefined, undefined, { productId, quantity: 1 });
        const token = first.newGuestToken;
        if (token) guestTokens.push(token);
        check("guest first add mints a cart", Boolean(token), "new guest token issued");
        check("guest first add holds one line", lineOf(first.cart).length === 1, `qty ${lineOf(first.cart)[0]?.quantity}`);

        const repeat = await measure(() =>
            CartService.addItem(undefined, token, { productId, quantity: 1 }),
        );
        check(
            "repeat add merges into the same line",
            lineOf(repeat.result.cart).length === 1 && lineOf(repeat.result.cart)[0].quantity === 2,
            `qty ${lineOf(repeat.result.cart)[0]?.quantity}, no new token: ${!repeat.result.newGuestToken}`,
        );
        const guestAdd = repeat;

        await Promise.all([
            CartService.addItem(undefined, token, { productId, quantity: 1 }),
            CartService.addItem(undefined, token, { productId, quantity: 1 }),
        ]);
        const afterRace = await CartService.getCart(undefined, token);
        check(
            "two racing adds both count",
            lineOf(afterRace.cart)[0]?.quantity === 4,
            `qty ${lineOf(afterRace.cart)[0]?.quantity} (expected 4)`,
        );

        const stranger = await CartService.addItem(undefined, "not-a-real-token", { productId, quantity: 1 });
        if (stranger.newGuestToken) guestTokens.push(stranger.newGuestToken);
        check(
            "an unknown token gets its own cart",
            Boolean(stranger.newGuestToken) && stranger.cart.id !== afterRace.cart.id && lineOf(stranger.cart)[0]?.quantity === 1,
            "new cart, qty 1",
        );
        const untouched = await CartService.getCart(undefined, token);
        check("the original guest cart is untouched", lineOf(untouched.cart)[0]?.quantity === 4, `qty ${lineOf(untouched.cart)[0]?.quantity}`);

        const itemId = untouched.cart.items.find((item) => item.productId === productId)!.id;
        const updated = await CartService.updateItemQuantity(undefined, token, itemId, 7);
        check("update resolves the same cart", lineOf(updated.cart)[0]?.quantity === 7, `qty ${lineOf(updated.cart)[0]?.quantity}`);
        const removed = await CartService.removeItem(undefined, token, itemId);
        check("remove resolves the same cart", lineOf(removed.cart).length === 0, "line gone");

        check(
            "response keeps its shape",
            ["id", "customerId", "guestToken", "createdAt", "updatedAt", "items", "discount"].every((key) => key in first.cart) &&
                ["product", "variant", "effectiveUnitPrice", "campaignUnitPrice"].every((key) => key in first.cart.items[0]) &&
                Array.isArray(first.cart.items[0].product.images),
            "cart, line and product fields present",
        );

        // --- Logged in ---

        const userId = await tempUser();
        const firstMember = await CartService.addItem(userId, undefined, { productId, quantity: 1 });
        check(
            "a customer's first add creates Customer + Cart",
            Boolean(firstMember.cart.customerId) && lineOf(firstMember.cart)[0]?.quantity === 1,
            `customerId ${firstMember.cart.customerId ? "set" : "missing"}`,
        );

        const member = await measure(() => CartService.addItem(userId, undefined, { productId, quantity: 1 }));
        check(
            "a customer's repeat add hits the same cart",
            member.result.cart.id === firstMember.cart.id && lineOf(member.result.cart)[0]?.quantity === 2,
            `qty ${lineOf(member.result.cart)[0]?.quantity}`,
        );

        const racer = await tempUser();
        const [a, b] = await Promise.all([CartService.getCart(racer, undefined), CartService.getCart(racer, undefined)]);
        const racerCarts = await prisma.cart.count({ where: { customer: { is: { userId: racer } } } });
        check("racing first requests converge on one cart", a.cart.id === b.cart.id && racerCarts === 1, `${racerCarts} cart(s)`);

        const guestForMerge = await CartService.addItem(undefined, undefined, { productId, quantity: 3 });
        if (guestForMerge.newGuestToken) guestTokens.push(guestForMerge.newGuestToken);
        await CartService.mergeGuestCartIntoCustomerCart(firstMember.cart.customerId!, guestForMerge.newGuestToken!);
        const merged = await CartService.getCart(userId, undefined);
        check("login merges guest quantities", lineOf(merged.cart)[0]?.quantity === 5, `qty ${lineOf(merged.cart)[0]?.quantity} (2 + 3)`);

        console.log(`\nguest add to an existing cart:   ${guestAdd.queries} queries, ${guestAdd.ms} ms`);
        console.log(`customer add to an existing cart: ${member.queries} queries, ${member.ms} ms (excludes optionalAuth)`);
    } finally {
        if (guestTokens.length > 0) {
            await prisma.cart.deleteMany({ where: { guestToken: { in: guestTokens } } });
        }
        if (userIds.length > 0) {
            // Cart cascades from Customer; Customer only nulls its userId when the user goes.
            await prisma.customer.deleteMany({ where: { userId: { in: userIds } } });
            await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        }
        await prisma.$disconnect();
    }

    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
    if (failures > 0) process.exitCode = 1;
};

main();
