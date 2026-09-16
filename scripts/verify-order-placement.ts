/**
 * A storefront checkout end to end — what it writes, and how many database
 * round trips it costs.
 *
 * `verify-checkout-totals.ts` covers the pricing arithmetic and
 * `verify-manual-order.ts` the staff path. Nothing covered the ordinary one: a
 * guest with a cart pressing "Place order". That path is also the longest
 * request in the API, and every Prisma call in it crosses to Neon in
 * ap-southeast-1, so its latency is roughly (sequential round trips × distance
 * to the database). This script pins the behaviour a round-trip reduction must
 * not change, then prints the count so a regression in either shows up here.
 *
 * Covered, for a two-line guest cart (a simple product and a variant):
 *   - the order's total is subtotal + delivery + tax, from catalogue prices
 *   - both lines are captured, and cost is withheld from the response
 *   - the warehouse ledger is decremented and a SALE movement written per line
 *   - the Product and ProductVariant stock mirrors are rebuilt from the ledger
 *   - the cart is emptied; a COD payment and the PENDING history row exist
 *   - the same idempotency key replays the SAME order instead of a second one
 *
 * Runs against the live database. Creates `__verify_order_`-prefixed products,
 * stock, a guest cart, a customer and an order, and deletes all of it —
 * including the staff notification placement fires — in the finally. Outbound
 * HTTP other than the local storefront is refused for the duration, so a
 * configured Conversions API cannot receive a test purchase.
 *
 * Run with: npx tsx scripts/verify-order-placement.ts
 */
import crypto from "crypto";
import pg from "pg";

/* ---------------------------------------------------------------------- *
 * Round-trip counting at the driver, below Prisma, so BEGIN/COMMIT and
 * every nested-include query count. `pg`'s pool calls `client.query` with a
 * callback, so the callback form is wrapped as well as the promise form.
 * ---------------------------------------------------------------------- */
let starts: number[] = [];
let statements: { at: number; sql: string }[] = [];
let clock = 0;
const originalQuery = pg.Client.prototype.query as (...args: unknown[]) => unknown;
(pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown }).query = function (
    this: pg.Client,
    ...args: unknown[]
) {
    const at = performance.now() - clock;
    starts.push(at);
    const first = args[0] as string | { text?: string } | undefined;
    statements.push({ at, sql: typeof first === "string" ? first : (first?.text ?? "") });
    return originalQuery.apply(this, args);
};

/** With TRACE=1, the placement's statements are printed in order, by table. */
const printTrace = () => {
    for (const { at, sql } of statements) {
        const flat = sql.replace(/\s+/g, " ");
        const table = flat.match(/(?:FROM|INTO|UPDATE) "(?:public"\.")?(\w+)"/i)?.[1] ?? "";
        console.log(`  +${String(Math.round(at)).padStart(5)}ms  ${flat.split(" ")[0]} ${table}`);
    }
};

/** Queries that started within 15ms of one another went out together. */
const sequentialRounds = (at: number[]) => {
    let rounds = 0;
    let last = -Infinity;
    for (const start of [...at].sort((a, b) => a - b)) {
        if (start - last > 15) {
            rounds += 1;
            last = start;
        }
    }
    return rounds;
};

const measure = async <T>(fn: () => Promise<T>) => {
    starts = [];
    statements = [];
    clock = performance.now();
    const result = await fn();
    const ms = performance.now() - clock;
    const during = starts.filter((start) => start <= ms);
    return { result, ms: Math.round(ms), queries: during.length, rounds: sequentialRounds(during) };
};

/* Refuse outbound HTTP for the run — only the local storefront may be reached. */
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
        throw new Error(`verify-order-placement refused outbound request to ${url}`);
    }
    return realFetch(input, init);
}) as typeof fetch;

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

const MARKER = "__verify_order_";

const main = async () => {
    const { prisma } = await import("../src/app/lib/prisma");
    const { CartService } = await import("../src/app/module/cart/cart.service");
    const { OrderService } = await import("../src/app/module/order/order.service");
    const { normalizePhone } = await import("../src/app/utils/phone");

    const warehouse = await prisma.warehouse.findFirst({ select: { id: true } });
    const category = await prisma.category.findFirst({ select: { id: true } });
    const setting = await prisma.storeSetting.findFirst({ select: { checkoutConfig: true } });
    const deliveryOption = (
        (setting?.checkoutConfig as { delivery?: { options?: { key: string; price: number }[] } } | null)
            ?.delivery?.options ?? []
    )[0];
    if (!warehouse || !category || !deliveryOption) {
        throw new Error("Needs a warehouse, a category and a configured delivery option");
    }

    const suffix = crypto.randomBytes(3).toString("hex");
    const phone = `0171${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
    const productIds: string[] = [];
    const guestTokens: string[] = [];
    const orderIds: string[] = [];

    try {
        /* ---------------- fixtures: one simple product, one variant ---------------- */
        const simple = await prisma.product.create({
            data: {
                name: `${MARKER}simple_${suffix}`,
                slug: `${MARKER}simple_${suffix}`,
                sku: `${MARKER}S_${suffix}`,
                categoryId: category.id,
                status: "ACTIVE",
                offerPrice: 500,
                purchasePrice: 300,
                lowStockThreshold: 0,
            },
        });
        const variable = await prisma.product.create({
            data: {
                name: `${MARKER}variable_${suffix}`,
                slug: `${MARKER}variable_${suffix}`,
                sku: `${MARKER}V_${suffix}`,
                categoryId: category.id,
                status: "ACTIVE",
                type: "VARIABLE",
                offerPrice: 900,
                lowStockThreshold: 0,
            },
        });
        productIds.push(simple.id, variable.id);
        const variant = await prisma.productVariant.create({
            data: {
                productId: variable.id,
                name: `${MARKER}variant_${suffix}`,
                sku: `${MARKER}VV_${suffix}`,
                offerPrice: 1000,
            },
        });

        await prisma.stock.createMany({
            data: [
                { warehouseId: warehouse.id, productId: simple.id, quantity: 20 },
                { warehouseId: warehouse.id, productId: variable.id, variantId: variant.id, quantity: 10 },
            ],
        });

        /* ---------------- a guest cart holding both lines ---------------- */
        const first = await CartService.addItem(undefined, undefined, { productId: simple.id, quantity: 2 });
        const guestToken = first.newGuestToken!;
        guestTokens.push(guestToken);
        await CartService.addItem(undefined, guestToken, {
            productId: variable.id,
            variantId: variant.id,
            quantity: 1,
        });

        const idempotencyKey = crypto.randomUUID();
        const actor = { kind: "guest" as const, ip: "127.0.0.1", guestToken };
        const payload = {
            fullName: `${MARKER}buyer`,
            phone,
            paymentMethod: "COD" as const,
            deliveryOptionKey: deliveryOption.key,
            shippingAddress: { addressLine1: `${MARKER}road`, city: "Dhaka" },
            idempotencyKey,
        };

        /* ---------------- place the order ---------------- */
        const placed = await measure(() => OrderService.placeOrder(actor, payload));
        if (process.env.TRACE) printTrace();
        const order = placed.result.order as unknown as {
            id: string;
            subtotal: unknown;
            shippingAmount: unknown;
            taxAmount: unknown;
            discountAmount: unknown;
            totalAmount: unknown;
            items: Record<string, unknown>[];
        };
        orderIds.push(order.id);

        const subtotal = Number(order.subtotal);
        check("subtotal is priced from the catalogue", near(subtotal, 2 * 500 + 1000), `subtotal ${subtotal}, expected 2000`);
        check(
            "total is subtotal + delivery + tax - discount",
            near(
                Number(order.totalAmount),
                subtotal + Number(order.shippingAmount) + Number(order.taxAmount) - Number(order.discountAmount),
            ),
            `total ${Number(order.totalAmount)}`,
        );
        check("both lines are captured", order.items.length === 2, `${order.items.length} item(s)`);
        check(
            "cost is withheld from the checkout response",
            order.items.every((item) => !("unitCost" in item)),
            "no unitCost on any item",
        );

        const [stockRows, movements, simpleAfter, variableAfter, variantAfter, cartAfter, payments, history] =
            await Promise.all([
                prisma.stock.findMany({ where: { productId: { in: productIds } } }),
                prisma.stockMovement.findMany({ where: { referenceId: order.id } }),
                prisma.product.findUniqueOrThrow({ where: { id: simple.id }, select: { stockQuantity: true } }),
                prisma.product.findUniqueOrThrow({ where: { id: variable.id }, select: { stockQuantity: true } }),
                prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id }, select: { stockQuantity: true } }),
                prisma.cart.findUnique({ where: { guestToken }, include: { items: true } }),
                prisma.payment.findMany({ where: { orderId: order.id } }),
                prisma.orderStatusHistory.findMany({ where: { orderId: order.id } }),
            ]);

        const ledger = (productId: string) => stockRows.find((row) => row.productId === productId)?.quantity;
        check("simple product's ledger decremented", ledger(simple.id) === 18, `quantity ${ledger(simple.id)}, expected 18`);
        check("variant's ledger decremented", ledger(variable.id) === 9, `quantity ${ledger(variable.id)}, expected 9`);
        check(
            "a SALE movement per line",
            movements.length === 2 && movements.every((m) => m.type === "SALE" && m.quantity < 0),
            `${movements.length} movement(s)`,
        );
        check(
            "stock mirrors rebuilt from the ledger",
            simpleAfter.stockQuantity === 18 && variableAfter.stockQuantity === 9 && variantAfter.stockQuantity === 9,
            `simple ${simpleAfter.stockQuantity}, variable ${variableAfter.stockQuantity}, variant ${variantAfter.stockQuantity}`,
        );
        check("the cart is emptied", cartAfter !== null && cartAfter.items.length === 0, `${cartAfter?.items.length ?? "no cart"} line(s) left`);
        check(
            "a pending COD payment for the total",
            payments.length === 1 && payments[0].method === "COD" && near(Number(payments[0].amount), Number(order.totalAmount)),
            `${payments.length} payment(s)`,
        );
        check("the history opens at PENDING", history.length === 1 && history[0].toStatus === "PENDING", `${history.length} row(s)`);

        /* ---------------- replay the same key ---------------- */
        const replay = await measure(() => OrderService.placeOrder(actor, payload));
        const replayOrder = replay.result.order as unknown as { id: string };
        check(
            "the same idempotency key replays the same order",
            replay.result.isReplay && replayOrder.id === order.id,
            `isReplay ${replay.result.isReplay}, same id ${replayOrder.id === order.id}`,
        );
        const orderCount = await prisma.order.count({ where: { idempotencyKey } });
        check("no second order was written", orderCount === 1, `${orderCount} order(s) for the key`);

        console.log(`\nguest checkout, 2 lines: ${placed.queries} queries in ${placed.rounds} sequential rounds, ${placed.ms} ms`);
        console.log(`idempotent replay:       ${replay.queries} queries in ${replay.rounds} sequential rounds, ${replay.ms} ms`);
    } finally {
        // The staff notification is fired without awaiting, after the response;
        // give it a moment to land so it is cleaned up rather than left behind.
        await new Promise((resolve) => setTimeout(resolve, 3000));

        if (orderIds.length > 0) {
            await prisma.notification.deleteMany({
                where: { link: { in: orderIds.map((id) => `/orders/${id}`) } },
            });
            await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
            await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
            await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
            await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
        }
        if (guestTokens.length > 0) {
            await prisma.cart.deleteMany({ where: { guestToken: { in: guestTokens } } });
        }
        await prisma.stockMovement.deleteMany({ where: { productId: { in: productIds } } });
        await prisma.stock.deleteMany({ where: { productId: { in: productIds } } });
        await prisma.productVariant.deleteMany({ where: { productId: { in: productIds } } });
        await prisma.product.deleteMany({ where: { id: { in: productIds } } });

        const normalized = normalizePhone(phone);
        if (normalized) {
            // Addresses cascade from the customer.
            await prisma.customer.deleteMany({ where: { phone: normalized, firstName: { startsWith: MARKER } } });
        }

        await prisma.$disconnect();
    }

    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
    if (failures > 0) process.exitCode = 1;
};

main();
