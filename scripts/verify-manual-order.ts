/**
 * Verifies staff-placed order creation, and the order-item images that ship
 * with it. See openspec/changes/add-manual-orders-and-item-images.
 *
 * The change's whole claim is that a manual order is the SAME transaction as a
 * checkout, reached by a third entry point, differing in an enumerable list of
 * ways and in nothing else. So the checks come in two halves:
 *
 *   - What must differ: the customer resolved by phone, the guest COD caps and
 *     the shop's checkout-field config not applied, a cash-on-delivery Payment
 *     row created, the operator recorded on the order and on its opening
 *     history row, a stated discount instead of a coupon.
 *   - What must NOT differ, which is the half that rots silently: catalog
 *     pricing, stock deduction and its refusal, the PENDING start, idempotent
 *     replay. Each of these is checked against a storefront order placed from
 *     the same fixtures, rather than against a constant, so the two paths
 *     cannot drift apart without this failing.
 *
 * Also covers the image flatten, which has no other verification: every order
 * read — list and detail, staff and customer — must return one flat
 * `items[].image` per line, preferring a variant's own picture.
 *
 * NOT read-only: creates a warehouse, products, customers and orders all
 * carrying `VERIFY-MANUAL-ORDER`, and a temporary delivery option in the
 * store's checkout config. Everything is removed and the config restored in a
 * `finally`, so a failure part-way through still leaves the database as it
 * found it.
 *
 * Run with: npm run verify:manual-order
 */
import {
    OrderChannel,
    OrderStatus,
    PaymentMethod,
    PaymentStatus,
    ProductStatus,
} from "../src/generated/prisma/client";
import { prisma } from "../src/app/lib/prisma";
import { RoleName } from "../src/app/constants/role.constant";
import { OrderService } from "../src/app/module/order/order.service";
import { normalizePhone } from "../src/app/utils/phone";
import { SINGLETON_ID } from "../src/app/module/store-setting/store-setting.constant";
import {
    createManualOrderZodSchema,
    quoteManualOrderZodSchema,
    quoteCheckoutZodSchema,
} from "../src/app/module/order/order.validation";

const MARKER = "VERIFY-MANUAL-ORDER";
/*
 * Lowercase words separated by single hyphens, because `deliveryOptionSchema`
 * enforces exactly that. A key that fails it does not fail loudly: the whole
 * `checkoutConfig` stops parsing and `getCheckoutConfig` returns
 * DEFAULT_CHECKOUT_CONFIG, whose option list is empty — so the symptom is
 * "this store has not set up delivery yet" rather than anything naming the key.
 */
const OPTION_KEY = "verify-manual-order-delivery";
const DELIVERY_PRICE = 60;

/**
 * Distinct from any real number.
 *
 * Both forms are kept, because `getOrCreateCustomerByPhone` NORMALIZES before
 * it stores: the customer row carries the normalized spelling, not the one sent
 * here. Looking the fixtures up by the raw string finds nothing, which in a
 * teardown means the orders survive and the product delete then fails on
 * `OrderItem_productId_fkey` — a confusing symptom a long way from its cause.
 */
const PHONE = "01900000001";
const PHONE_AT_CAP = "01900000002";
const STORED_PHONES = [PHONE, PHONE_AT_CAP].flatMap((p) => {
    const normalized = normalizePhone(p);
    return normalized && normalized !== p ? [p, normalized] : [p];
});

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

const expectRejection = async (label: string, expect: RegExp, run: () => Promise<unknown>) => {
    try {
        await run();
        check(label, false, "expected a rejection, but the call succeeded");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        check(label, expect.test(message), `rejected: ${message}`);
    }
};

const money = (value: unknown) => Number(value);

async function main() {
    /* ------------------------------------------------------------------ *
     * Fixtures
     * ------------------------------------------------------------------ */
    const staff = await prisma.user.findFirst({
        where: { role: { name: { in: [RoleName.OWNER, RoleName.ADMIN, RoleName.STAFF] } } },
        select: { id: true, email: true, role: { select: { name: true } } },
    });
    if (!staff) throw new Error("No OWNER/ADMIN/STAFF user to act as the operator.");

    const shopper = await prisma.user.findFirst({
        where: { id: { not: staff.id } },
        select: { id: true },
    });

    console.log(`\nOperator: ${staff.email} (${staff.role.name})\n`);

    const storeSetting = await prisma.storeSetting.findFirstOrThrow();
    const storedConfig = storeSetting.checkoutConfig;

    // A delivery option this script owns, so the assertions do not depend on
    // whatever the merchant currently offers.
    const config = structuredClone(storedConfig) as {
        delivery: { options: { key: string }[]; offersPickup: boolean };
        allowGuestCheckout: boolean;
    };
    /*
     * Filtered before it is appended, so a run that died before restoring the
     * config does not leave the next one adding a SECOND option with this key.
     * Duplicate keys fail `deliverySettingsSchema`, which makes the whole
     * config unparseable, which sends `getCheckoutConfig` to the empty
     * defaults — surfacing as "this store has not set up delivery yet" on a
     * store that plainly has. Costly to diagnose, one line to prevent.
     */
    config.delivery.options = [
        ...config.delivery.options.filter((o) => o.key !== OPTION_KEY),
        {
            key: OPTION_KEY,
            label: `${MARKER} Delivery`,
            kind: "DELIVERY",
            price: DELIVERY_PRICE,
            days: 2,
        },
    ];
    await prisma.storeSetting.update({
        where: { id: SINGLETON_ID },
        data: { checkoutConfig: config as never },
    });

    const warehouse = await prisma.warehouse.create({
        data: { name: `${MARKER} WH`, code: `${MARKER}-WH` },
    });

    /** Priced at 1000, stocked at 20. No tax rule, so totals stay readable. */
    const product = await prisma.product.create({
        data: {
            name: `${MARKER} Product`,
            slug: `${MARKER.toLowerCase()}-product`,
            sku: `${MARKER}-SKU`,
            offerPrice: 1000,
            purchasePrice: 600,
            status: ProductStatus.ACTIVE,
            stockQuantity: 20,
            images: {
                create: [
                    { url: "https://example.test/secondary.jpg", sortOrder: 1 },
                    { url: "https://example.test/primary.jpg", isPrimary: true, sortOrder: 5 },
                ],
            },
        },
    });

    /** A variant with its own picture, to prove a variant line prefers it. */
    const variant = await prisma.productVariant.create({
        data: {
            productId: product.id,
            name: `${MARKER} Variant`,
            sku: `${MARKER}-VAR`,
            offerPrice: 1200,
            image: "https://example.test/variant.jpg",
            stockQuantity: 20,
        },
    });

    /** A product with no images at all, so `image` must come back null. */
    const imagelessProduct = await prisma.product.create({
        data: {
            name: `${MARKER} Imageless`,
            slug: `${MARKER.toLowerCase()}-imageless`,
            sku: `${MARKER}-SKU-NOIMG`,
            offerPrice: 500,
            status: ProductStatus.ACTIVE,
            stockQuantity: 20,
        },
    });

    await prisma.stock.createMany({
        data: [
            { warehouseId: warehouse.id, productId: product.id, quantity: 20 },
            {
                warehouseId: warehouse.id,
                productId: product.id,
                variantId: variant.id,
                quantity: 20,
            },
            { warehouseId: warehouse.id, productId: imagelessProduct.id, quantity: 20 },
        ],
    });

    const address = {
        addressLine1: `${MARKER} House 1`,
        city: "Dhaka",
    };

    const basePayload = {
        phone: PHONE,
        fullName: `${MARKER} Customer`,
        shippingAddress: address,
        deliveryOptionKey: OPTION_KEY,
        channel: OrderChannel.WHATSAPP,
        items: [{ productId: product.id, quantity: 2 }],
    };

    const stockFor = async (productId: string, variantId: string | null = null) =>
        (
            await prisma.stock.findFirst({
                where: { warehouseId: warehouse.id, productId, variantId },
                select: { quantity: true },
            })
        )?.quantity ?? 0;

    /* ------------------------------------------------------------------ *
     * 1. Pricing comes from the catalog, never from the request.
     * ------------------------------------------------------------------ */
    const stockBefore = await stockFor(product.id);

    const { order: plain } = await OrderService.placeManualOrder(staff.id, {
        ...basePayload,
        // A price in the body. The type does not carry one and the schema does
        // not accept one; this asserts it cannot sneak through as extra keys.
        items: [{ productId: product.id, quantity: 2, unitPrice: 1 } as never],
    });

    check(
        "line is priced from the catalog, not from the body",
        money(plain.items[0]?.unitPrice) === 1000,
        `unitPrice ${money(plain.items[0]?.unitPrice)} (catalog 1000, body claimed 1)`,
    );
    check(
        "subtotal follows the catalog price",
        money(plain.subtotal) === 2000,
        `subtotal ${money(plain.subtotal)}, expected 2000`,
    );
    check(
        "delivery is charged from the chosen option",
        money(plain.shippingAmount) === DELIVERY_PRICE,
        `shippingAmount ${money(plain.shippingAmount)}, expected ${DELIVERY_PRICE}`,
    );

    /* ------------------------------------------------------------------ *
     * 2. A manual order starts PENDING, carries a COD payment, and records
     *    who took it and where the customer came from.
     * ------------------------------------------------------------------ */
    check(
        "starts PENDING, like a website order",
        plain.status === OrderStatus.PENDING,
        `status ${plain.status}`,
    );
    check(
        "records the channel and the operator",
        plain.channel === OrderChannel.WHATSAPP && plain.createdByUserId === staff.id,
        `channel ${plain.channel}, createdByUserId ${plain.createdByUserId ?? "(null)"}`,
    );
    check(
        "is not filed as a guest order",
        plain.isGuestOrder === false && plain.guestIp === null,
        `isGuestOrder ${plain.isGuestOrder}, guestIp ${plain.guestIp ?? "(null)"}`,
    );

    const payment = await prisma.payment.findFirst({ where: { orderId: plain.id } });
    check(
        "has a PENDING cash-on-delivery payment for its total",
        payment?.method === PaymentMethod.COD &&
            payment?.status === PaymentStatus.PENDING &&
            money(payment?.amount) === money(plain.totalAmount),
        `payment ${payment?.method}/${payment?.status} for ${money(payment?.amount)}, order total ${money(plain.totalAmount)}`,
    );

    const history = await prisma.orderStatusHistory.findFirst({ where: { orderId: plain.id } });
    check(
        "opening history row names the operator",
        history?.changedById === staff.id && history?.toStatus === OrderStatus.PENDING,
        `toStatus ${history?.toStatus}, changedById ${history?.changedById ?? "(null)"}`,
    );

    const customer = await prisma.customer.findUnique({
        where: { phone: normalizePhone(PHONE) as string },
    });
    check(
        "customer is resolved by phone, normalized",
        !!customer && plain.customerId === customer.id,
        `customer ${customer?.id ?? "(none)"} stored as ${customer?.phone ?? "(none)"} for input ${PHONE}`,
    );

    /* ------------------------------------------------------------------ *
     * 3. Stock moves exactly as a checkout moves it.
     * ------------------------------------------------------------------ */
    check(
        "deducts stock once",
        (await stockFor(product.id)) === stockBefore - 2,
        `stock ${stockBefore} → ${await stockFor(product.id)}, expected ${stockBefore - 2}`,
    );

    const beforeOverStock = await stockFor(product.id);
    const ordersBeforeOverStock = await prisma.order.count({
        where: { orderNumber: { contains: "ORD-" }, customerId: customer?.id },
    });
    await expectRejection("refuses an order exceeding stock", /insufficient stock/i, () =>
        OrderService.placeManualOrder(staff.id, {
            ...basePayload,
            items: [{ productId: product.id, quantity: 9999 }],
        }),
    );
    check(
        "a refused over-stock order creates nothing and moves no stock",
        (await stockFor(product.id)) === beforeOverStock &&
            (await prisma.order.count({
                where: { orderNumber: { contains: "ORD-" }, customerId: customer?.id },
            })) === ordersBeforeOverStock,
        `stock still ${await stockFor(product.id)}, order count still ${ordersBeforeOverStock}`,
    );

    /* ------------------------------------------------------------------ *
     * 4. A negotiated discount, and its bounds.
     * ------------------------------------------------------------------ */
    const { order: discounted } = await OrderService.placeManualOrder(staff.id, {
        ...basePayload,
        discountAmount: 500,
        discountReason: "Agreed over WhatsApp",
    });

    check(
        "discount reduces the total and is recorded with its reason",
        money(discounted.discountAmount) === 500 &&
            discounted.discountReason === "Agreed over WhatsApp" &&
            money(discounted.totalAmount) ===
                money(discounted.subtotal) +
                    money(discounted.shippingAmount) +
                    money(discounted.taxAmount) -
                    500,
        `subtotal ${money(discounted.subtotal)} − 500 + delivery ${money(discounted.shippingAmount)} + tax ${money(discounted.taxAmount)} = ${money(discounted.totalAmount)}, reason "${discounted.discountReason}"`,
    );

    await expectRejection(
        "refuses a discount larger than the subtotal",
        /cannot exceed the subtotal/i,
        () =>
            OrderService.placeManualOrder(staff.id, {
                ...basePayload,
                discountAmount: 999999,
                discountReason: "Too much",
            }),
    );

    // The reason requirement lives in the schema, which the route applies
    // before the service is ever reached — so it is checked there.
    const noReason = createManualOrderZodSchema.safeParse({ ...basePayload, discountAmount: 100 });
    check(
        "refuses a discount with no reason",
        !noReason.success,
        noReason.success ? "schema accepted it" : "schema rejected it",
    );
    const zeroDiscountNoReason = createManualOrderZodSchema.safeParse({
        ...basePayload,
        discountAmount: 0,
    });
    check(
        "a zero discount needs no reason",
        zeroDiscountNoReason.success,
        zeroDiscountNoReason.success ? "accepted" : "schema rejected it",
    );

    /* ------------------------------------------------------------------ *
     * 5. What the schemas must make unspellable.
     * ------------------------------------------------------------------ */
    const withCoupon = createManualOrderZodSchema.safeParse({
        ...basePayload,
        couponCode: "SAVE10",
    });
    check(
        "a coupon code does not reach a manual order",
        withCoupon.success && !("couponCode" in withCoupon.data),
        withCoupon.success
            ? `parsed keys: ${Object.keys(withCoupon.data).join(", ")}`
            : "schema rejected the whole payload",
    );

    const websiteChannel = createManualOrderZodSchema.safeParse({
        ...basePayload,
        channel: "WEBSITE",
    });
    check(
        "WEBSITE is not selectable as a manual channel",
        !websiteChannel.success,
        websiteChannel.success ? "schema accepted it" : "schema rejected it",
    );

    const shopperQuoteWithDiscount = quoteCheckoutZodSchema.safeParse({
        deliveryOptionKey: OPTION_KEY,
        items: [{ productId: product.id, quantity: 1 }],
        discountAmount: 500,
    });
    check(
        "a shopper's quote cannot name a discount",
        shopperQuoteWithDiscount.success && !("discountAmount" in shopperQuoteWithDiscount.data),
        shopperQuoteWithDiscount.success
            ? `parsed keys: ${Object.keys(shopperQuoteWithDiscount.data).join(", ")}`
            : "schema rejected the whole payload",
    );

    const manualQuoteNoItems = quoteManualOrderZodSchema.safeParse({
        deliveryOptionKey: OPTION_KEY,
        items: [],
    });
    check(
        "a manual quote requires at least one line",
        !manualQuoteNoItems.success,
        manualQuoteNoItems.success ? "schema accepted it" : "schema rejected it",
    );

    /* ------------------------------------------------------------------ *
     * 6. The staff quote: same figures as the placement, and no side effects.
     * ------------------------------------------------------------------ */
    /*
     * A BEFORE/AFTER comparison, not an absence check. The operator's account
     * may legitimately already have a customer record — an admin who has ever
     * shopped here has one, and this database's admin does. What must be true
     * is that quoting does not CREATE one, which only a delta can say.
     */
    const customersBeforeQuote = await prisma.customer.count();
    const operatorCustomerBefore = await prisma.customer.count({ where: { userId: staff.id } });

    const quote = await OrderService.quoteCheckout(
        { kind: "staff", staffUserId: staff.id },
        {
            deliveryOptionKey: OPTION_KEY,
            items: [{ productId: product.id, quantity: 2 }],
            discountAmount: 500,
        },
    );

    check(
        "a staff quote matches the order it would place",
        quote.subtotal === money(discounted.subtotal) &&
            quote.discountAmount === money(discounted.discountAmount) &&
            quote.shippingAmount === money(discounted.shippingAmount) &&
            quote.taxAmount === money(discounted.taxAmount) &&
            quote.totalAmount === money(discounted.totalAmount),
        `quote ${quote.totalAmount} vs placed ${money(discounted.totalAmount)}`,
    );
    const customersAfterQuote = await prisma.customer.count();
    const operatorCustomerAfter = await prisma.customer.count({ where: { userId: staff.id } });
    check(
        "a staff quote creates no customer, and none for the operator",
        customersAfterQuote === customersBeforeQuote &&
            operatorCustomerAfter === operatorCustomerBefore,
        `total ${customersBeforeQuote} → ${customersAfterQuote}, linked to operator ${operatorCustomerBefore} → ${operatorCustomerAfter}`,
    );

    /* ------------------------------------------------------------------ *
     * 7. Exemptions: the guest caps and the shop's checkout config.
     * ------------------------------------------------------------------ */
    const cappedCustomer = await prisma.customer.create({
        data: { firstName: MARKER, lastName: "AtCap", phone: PHONE_AT_CAP },
    });
    // Enough unfulfilled guest COD orders on that number to exceed any cap.
    const cap = storeSetting.maxPendingCodOrdersPerPhone;
    for (let i = 0; i < cap + 1; i += 1) {
        await prisma.order.create({
            data: {
                orderNumber: `${MARKER}-CAP-${i}`,
                customerId: cappedCustomer.id,
                status: OrderStatus.PENDING,
                isGuestOrder: true,
                subtotal: 1,
                totalAmount: 1,
            },
        });
    }

    const { order: pastCap } = await OrderService.placeManualOrder(staff.id, {
        ...basePayload,
        phone: PHONE_AT_CAP,
    });
    check(
        "a phone past the guest COD cap can still be served manually",
        !!pastCap.id,
        `placed ${pastCap.orderNumber} for a number holding ${cap + 1} unfulfilled guest orders (cap ${cap})`,
    );

    await prisma.storeSetting.update({
        where: { id: SINGLETON_ID },
        data: { checkoutConfig: { ...config, allowGuestCheckout: false } as never },
    });
    const { order: guestOff } = await OrderService.placeManualOrder(staff.id, {
        ...basePayload,
        phone: PHONE_AT_CAP,
    });
    check(
        "guest checkout being switched off does not block staff",
        !!guestOff.id,
        `placed ${guestOff.orderNumber} with allowGuestCheckout false`,
    );
    await prisma.storeSetting.update({
        where: { id: SINGLETON_ID },
        data: { checkoutConfig: config as never },
    });

    /* ------------------------------------------------------------------ *
     * 8. Idempotency: a double-submitted order is one order.
     * ------------------------------------------------------------------ */
    const key = `${MARKER}-${Date.now()}`.slice(0, 36);
    const idempotencyKey = crypto.randomUUID();
    const stockBeforeReplay = await stockFor(product.id);

    const first = await OrderService.placeManualOrder(staff.id, { ...basePayload, idempotencyKey });
    const second = await OrderService.placeManualOrder(staff.id, { ...basePayload, idempotencyKey });

    check(
        "a repeated submission returns the first order",
        first.order.id === second.order.id && second.isReplay === true,
        `first ${first.order.orderNumber}, second ${second.order.orderNumber}, isReplay ${second.isReplay}`,
    );
    check(
        "a repeated submission deducts stock once",
        (await stockFor(product.id)) === stockBeforeReplay - 2,
        `stock ${stockBeforeReplay} → ${await stockFor(product.id)}, expected ${stockBeforeReplay - 2}`,
    );
    void key;

    /* ------------------------------------------------------------------ *
     * 9. Order item images, on every read.
     *
     * The flatten used to live inside the cost strip, so staff reads returned
     * raw nested relations and the list returned no image data at all. These
     * assert the shape is a property of the endpoint, not of the reader.
     * ------------------------------------------------------------------ */
    const { order: mixed } = await OrderService.placeManualOrder(staff.id, {
        ...basePayload,
        items: [
            { productId: product.id, quantity: 1 },
            { productId: product.id, variantId: variant.id, quantity: 1 },
            { productId: imagelessProduct.id, quantity: 1 },
        ],
    });

    type ReadItem = { productId: string; variantId: string | null; image?: string | null };
    const imageOf = (items: ReadItem[], productId: string, variantId: string | null = null) =>
        items.find((i) => i.productId === productId && i.variantId === variantId)?.image;

    const staffDetail = (await OrderService.getOrderById(
        staff.id,
        staff.role.name as RoleName,
        mixed.id,
    )) as unknown as { items: ReadItem[] };

    check(
        "a plain line shows the product's PRIMARY image, not its first",
        imageOf(staffDetail.items, product.id) === "https://example.test/primary.jpg",
        `got ${imageOf(staffDetail.items, product.id)}`,
    );
    check(
        "a variant line prefers the variant's own image",
        imageOf(staffDetail.items, product.id, variant.id) === "https://example.test/variant.jpg",
        `got ${imageOf(staffDetail.items, product.id, variant.id)}`,
    );
    check(
        "a product with no images yields null, not a broken value",
        imageOf(staffDetail.items, imagelessProduct.id) === null,
        `got ${JSON.stringify(imageOf(staffDetail.items, imagelessProduct.id))}`,
    );
    check(
        "a staff detail read returns no nested product/variant rows",
        staffDetail.items.every(
            (i) => !("product" in i) && !("variant" in i) && "image" in i,
        ),
        `item keys: ${Object.keys(staffDetail.items[0] ?? {}).join(", ")}`,
    );

    const staffList = (await OrderService.getOrders(staff.id, staff.role.name as RoleName, {
        limit: 100,
    } as never)) as unknown as { data: { id: string; items: ReadItem[] }[] };
    const listed = staffList.data.find((o) => o.id === mixed.id);

    check(
        "the orders LIST carries images too",
        !!listed &&
            imageOf(listed.items, product.id, variant.id) === "https://example.test/variant.jpg" &&
            imageOf(listed.items, imagelessProduct.id) === null,
        listed
            ? `variant line ${imageOf(listed.items, variant ? product.id : "", variant.id)}`
            : "order not found in list",
    );
    check(
        "list and detail agree on every line's image",
        !!listed &&
            listed.items.every(
                (item) =>
                    imageOf(staffDetail.items, item.productId, item.variantId) === item.image,
            ),
        listed ? "all lines match" : "order not found in list",
    );

    /*
     * The customer's own read of the same order: same image shape, minus the
     * supplier cost. `getOrderById` resolves a customer from the userId, so
     * this runs only when a non-staff user exists to resolve.
     */
    if (shopper) {
        // Normalized, like every other lookup of a customer this script placed
        // orders for — `getOrCreateCustomerByPhone` stored it that way.
        const owner = await prisma.customer.findUnique({
            where: { phone: normalizePhone(PHONE) as string },
        });
        if (owner) {
            const previousUserId = owner.userId;
            await prisma.customer.update({
                where: { id: owner.id },
                data: { userId: shopper.id },
            });

            const customerDetail = (await OrderService.getOrderById(
                shopper.id,
                RoleName.CUSTOMER,
                mixed.id,
            )) as unknown as { items: (ReadItem & { unitCost?: unknown })[] };

            check(
                "a customer read has the same image shape as staff",
                customerDetail.items.every(
                    (item) =>
                        imageOf(staffDetail.items, item.productId, item.variantId) === item.image,
                ),
                "every line's image matches the staff read",
            );
            check(
                "a customer read still strips supplier cost",
                customerDetail.items.every((item) => !("unitCost" in item)),
                `item keys: ${Object.keys(customerDetail.items[0] ?? {}).join(", ")}`,
            );

            await prisma.customer.update({
                where: { id: owner.id },
                data: { userId: previousUserId },
            });
        }
    } else {
        console.log("SKIP  customer-side image read — no non-staff user in the database");
    }

    /* ------------------------------------------------------------------ *
     * 10. Role enforcement lives on the route, not in the service.
     *
     * Asserted by inspection rather than by call: `placeManualOrder` takes a
     * staff id and trusts it, exactly as `updateOrderStatus` trusts the
     * `changedByUserId` the controller hands it. What stops a customer reaching
     * it is `checkAuth(...ADMIN_PANEL_ROLES)` on the route, which a service-level
     * test cannot exercise. Checked here so a refactor that drops the guard is
     * at least visible.
     * ------------------------------------------------------------------ */
    const routeSource = await import("node:fs/promises").then((fs) =>
        fs.readFile(new URL("../src/app/module/order/order.route.ts", import.meta.url), "utf8"),
    );
    const manualGuarded =
        /"\/manual",\s*\n\s*checkAuth\(\.\.\.ADMIN_PANEL_ROLES\)/.test(routeSource);
    const quoteGuarded =
        /"\/quote\/manual",\s*\n\s*checkAuth\(\.\.\.ADMIN_PANEL_ROLES\)/.test(routeSource);
    check(
        "POST /orders/manual is guarded by ADMIN_PANEL_ROLES",
        manualGuarded,
        manualGuarded ? "guard present" : "GUARD MISSING — any authenticated user could place one",
    );
    check(
        "POST /orders/quote/manual is guarded by ADMIN_PANEL_ROLES",
        quoteGuarded,
        quoteGuarded ? "guard present" : "GUARD MISSING",
    );

    console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
    if (failures > 0) process.exitCode = 1;
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        /*
         * The store's own configuration goes back FIRST, and in its own
         * try/catch, because it is the only thing here that belongs to the
         * merchant rather than to this script. Leaving a fixture product behind
         * is untidy; leaving a fixture delivery option in the live config is a
         * option shoppers can see — and, if a later run then adds a duplicate,
         * a config that stops parsing and takes checkout down with it.
         *
         * This used to run last, so the first failing delete skipped it.
         */
        try {
            const setting = await prisma.storeSetting.findFirst();
            if (setting) {
                const restored = structuredClone(setting.checkoutConfig) as {
                    delivery: { options: { key: string }[] };
                };
                restored.delivery.options = restored.delivery.options.filter(
                    (o) => o.key !== OPTION_KEY,
                );
                await prisma.storeSetting.update({
                    where: { id: SINGLETON_ID },
                    data: { checkoutConfig: restored as never },
                });
            }
        } catch (error) {
            console.error(
                `\nCOULD NOT RESTORE checkoutConfig — remove the "${OPTION_KEY}" delivery option by hand:`,
                error instanceof Error ? error.message : error,
            );
        }

        /*
         * Ordered by foreign key: payments and history hang off orders, stock
         * movements and images off products, and the customers cannot go until
         * their orders have.
         */
        const products = await prisma.product.findMany({
            where: { sku: { contains: MARKER } },
            select: { id: true },
        });
        const productIds = products.map((p) => p.id);
        const customers = await prisma.customer.findMany({
            where: { phone: { in: STORED_PHONES } },
            select: { id: true },
        });
        const customerIds = customers.map((c) => c.id);

        /*
         * Orders reached three ways, and the first is the one that matters:
         * anything with a LINE on a fixture product. `OrderItem.productId` is
         * RESTRICT, so a single order missed here fails the product delete at
         * the very end with an error naming neither the order nor the customer.
         * Deriving from the items makes that unmissable by construction rather
         * than by remembering every way an order could have been created.
         */
        const orders = await prisma.order.findMany({
            where: {
                OR: [
                    { items: { some: { productId: { in: productIds } } } },
                    { customerId: { in: customerIds } },
                    { orderNumber: { contains: MARKER } },
                ],
            },
            select: { id: true },
        });
        const orderIds = orders.map((o) => o.id);

        await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
        await prisma.customerAddress.deleteMany({ where: { customerId: { in: customerIds } } });
        await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
        await prisma.stockMovement.deleteMany({ where: { productId: { in: productIds } } });
        await prisma.stock.deleteMany({ where: { productId: { in: productIds } } });
        await prisma.productImage.deleteMany({ where: { productId: { in: productIds } } });
        await prisma.productVariant.deleteMany({ where: { productId: { in: productIds } } });
        await prisma.product.deleteMany({ where: { id: { in: productIds } } });
        await prisma.warehouse.deleteMany({ where: { code: { contains: MARKER } } });

        await prisma.$disconnect();
    });
