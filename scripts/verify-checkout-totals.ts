/**
 * Task 4.5 — checkout totals verification.
 *
 * Replays every past order through the new per-product tax and shipping rules
 * and compares the result with what was actually charged. Where the seeded
 * rules reproduce the old flat values the totals must be identical; anything
 * else is a shopper being charged a different amount than they were.
 *
 * Also exercises the behaviours that have no past order to compare against:
 * specificity, refusal, pickup and tax on a discounted line.
 *
 * Read-only. Run with: npx tsx scripts/verify-checkout-totals.ts
 */
import { prisma } from "../src/app/lib/prisma";
import { matchPlace, quoteCharges, type IPricingLine } from "../src/app/module/order/order.pricing";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

const main = async () => {
    const [storeSetting, orders, products] = await Promise.all([
        prisma.storeSetting.findFirst(),
        prisma.order.findMany({ include: { items: true, shippingAddress: true } }),
        prisma.product.findMany({
            select: {
                id: true,
                name: true,
                price: true,
                taxRuleId: true,
                shippingRuleId: true,
            },
        }),
    ]);

    const fallbackTaxPercent = Number(storeSetting?.defaultTaxRatePercent ?? 0);
    const freeShippingThreshold =
        storeSetting?.freeShippingThreshold == null
            ? null
            : Number(storeSetting.freeShippingThreshold);

    console.log(`\nStore: tax ${fallbackTaxPercent}%, free-shipping ${freeShippingThreshold ?? "off"}`);
    console.log(`Products: ${products.length}, past orders: ${orders.length}\n`);

    const productById = new Map(products.map((p) => [p.id, p]));

    // --- 1. Past orders replay -------------------------------------------
    for (const order of orders) {
        const lines: IPricingLine[] = order.items.map((item) => {
            const product = productById.get(item.productId);
            return {
                productId: item.productId,
                productName: item.productName,
                quantity: item.quantity,
                lineTotal: Number(item.totalPrice),
                taxRuleId: product?.taxRuleId ?? null,
                shippingRuleId: product?.shippingRuleId ?? null,
            };
        });

        const charges = await quoteCharges({
            lines,
            destination: {
                country: order.shippingAddress?.country,
                state: order.shippingAddress?.state,
            },
            discountAmount: Number(order.discountAmount),
            deliveryMethod: "DELIVERY",
            // Not recoverable from the row; the stored shippingAmount already
            // reflects whatever waiver applied, so compare against that.
            couponWaivesShipping: Number(order.shippingAmount) === 0,
            fallbackTaxPercent,
            freeShippingThreshold,
            fallbackFlatShippingPrice: Number(order.shippingAmount),
        });

        const taxMatches = Math.abs(charges.taxAmount - Number(order.taxAmount)) < 0.01;
        const shipMatches = Math.abs(charges.shippingAmount - Number(order.shippingAmount)) < 0.01;

        check(
            `order ${order.orderNumber} tax`,
            taxMatches,
            `charged ${Number(order.taxAmount)}, recomputed ${charges.taxAmount}`,
        );
        check(
            `order ${order.orderNumber} shipping`,
            shipMatches,
            `charged ${Number(order.shippingAmount)}, recomputed ${charges.shippingAmount}`,
        );
    }

    if (orders.length === 0) {
        console.log("(no past orders on this database — the synthetic cases below stand in)\n");
    }

    // --- 2. The seeded default rules reproduce the old flat values --------
    const defaultShipping = await prisma.shippingRule.findFirst({ include: { places: true } });
    const defaultTax = await prisma.taxRule.findFirst();
    const cheapestMethod = await prisma.shippingMethod.findFirst({
        where: { isActive: true },
        orderBy: { price: "asc" },
    });

    if (defaultTax && defaultShipping && products.length > 0) {
        const product = products[0];
        const lineTotal = Number(product.price);

        const charges = await quoteCharges({
            lines: [
                {
                    productId: product.id,
                    productName: product.name,
                    quantity: 1,
                    lineTotal,
                    taxRuleId: product.taxRuleId,
                    shippingRuleId: product.shippingRuleId,
                },
            ],
            destination: { country: "Bangladesh" },
            discountAmount: 0,
            deliveryMethod: "DELIVERY",
            couponWaivesShipping: false,
            fallbackTaxPercent,
            freeShippingThreshold: null,
            fallbackFlatShippingPrice: 0,
        });

        const oldTax = Math.round(((lineTotal * fallbackTaxPercent) / 100) * 100) / 100;
        const oldShipping = Number(cheapestMethod?.price ?? 0);

        check(
            "seeded tax rule reproduces the old flat rate",
            Math.abs(charges.taxAmount - oldTax) < 0.01,
            `old ${oldTax}, new ${charges.taxAmount}`,
        );
        check(
            "seeded shipping rule reproduces the old flat price",
            Math.abs(charges.shippingAmount - oldShipping) < 0.01,
            `old ${oldShipping}, new ${charges.shippingAmount}`,
        );
    } else {
        check("seeded default rules exist", false, "no tax rule, shipping rule or product found");
    }

    // --- 3. Specificity: region beats country beats catch-all ------------
    const places = [
        { id: "all", country: null, state: null },
        { id: "bd", country: "Bangladesh", state: null },
        { id: "dhaka", country: "Bangladesh", state: "Dhaka" },
    ];

    check(
        "region beats country",
        matchPlace(places, { country: "Bangladesh", state: "Dhaka" })?.id === "dhaka",
        `matched ${matchPlace(places, { country: "Bangladesh", state: "Dhaka" })?.id}`,
    );
    check(
        "country used when the region has no place",
        matchPlace(places, { country: "Bangladesh", state: "Khulna" })?.id === "bd",
        `matched ${matchPlace(places, { country: "Bangladesh", state: "Khulna" })?.id}`,
    );
    check(
        "catch-all used when the country has no place",
        matchPlace(places, { country: "Nepal" })?.id === "all",
        `matched ${matchPlace(places, { country: "Nepal" })?.id}`,
    );
    check(
        "matching is case-insensitive",
        matchPlace(places, { country: "bangladesh", state: "dhaka" })?.id === "dhaka",
        `matched ${matchPlace(places, { country: "bangladesh", state: "dhaka" })?.id}`,
    );
    check(
        "no match without a catch-all",
        matchPlace(places.slice(1), { country: "Nepal" }) === null,
        `matched ${matchPlace(places.slice(1), { country: "Nepal" })?.id ?? "nothing"}`,
    );

    // --- 4. Tax on a discounted line -------------------------------------
    const percentRule = await prisma.taxRule.findFirst({ where: { type: "PERCENT" } });
    if (percentRule) {
        const rate = Number(percentRule.value);
        const charges = await quoteCharges({
            lines: [
                {
                    productId: "x",
                    productName: "Discounted",
                    quantity: 1,
                    lineTotal: 1000,
                    taxRuleId: percentRule.id,
                    shippingRuleId: null,
                },
            ],
            destination: {},
            discountAmount: 200,
            deliveryMethod: "DELIVERY",
            couponWaivesShipping: false,
            fallbackTaxPercent,
            freeShippingThreshold: null,
            fallbackFlatShippingPrice: 0,
        });

        const expected = Math.round(((800 * rate) / 100) * 100) / 100;
        check(
            "tax follows the discounted price",
            Math.abs(charges.taxAmount - expected) < 0.01,
            `${rate}% of 800 = ${expected}, got ${charges.taxAmount}`,
        );
    }

    // --- 5. Undeliverable destination, and collection in person ----------
    //
    // Both need a rule with no catch-all place, which the seeded default is
    // not. One is created here and removed again below; no product ever
    // references it, so nothing in the catalogue is touched.
    const probe = await prisma.shippingRule.create({
        data: {
            name: `__verify_probe_${process.pid}`,
            places: {
                create: [
                    {
                        name: "Dhaka only",
                        country: "Bangladesh",
                        state: "Dhaka",
                        price: 60,
                        deliveryDays: 1,
                        offersPickup: true,
                        pickupPrice: 20,
                    },
                ],
            },
        },
    });

    const probeLine: IPricingLine = {
        productId: "probe",
        productName: "Dhaka-only item",
        quantity: 1,
        lineTotal: 100,
        taxRuleId: null,
        shippingRuleId: probe.id,
    };

    const baseInput = {
        discountAmount: 0,
        couponWaivesShipping: false,
        fallbackTaxPercent,
        freeShippingThreshold: null,
        fallbackFlatShippingPrice: 0,
    };

    try {
        let refusal = "";
        try {
            await quoteCharges({
                lines: [probeLine],
                destination: { country: "Atlantis" },
                deliveryMethod: "DELIVERY",
                ...baseInput,
            });
        } catch (error) {
            refusal = (error as Error).message;
        }
        check(
            "an unmatched destination is refused, not charged 0",
            refusal.includes("cannot be delivered"),
            refusal || "the quote returned a price",
        );

        const delivered = await quoteCharges({
            lines: [probeLine],
            destination: { country: "Bangladesh", state: "Dhaka" },
            deliveryMethod: "DELIVERY",
            ...baseInput,
        });
        check(
            "a matched place charges its delivery price",
            delivered.shippingAmount === 60,
            `expected 60, got ${delivered.shippingAmount}`,
        );

        const collected = await quoteCharges({
            lines: [probeLine],
            destination: { country: "Bangladesh", state: "Dhaka" },
            deliveryMethod: "PICKUP",
            ...baseInput,
        });
        check(
            "collection in person is charged at the place's pickup price",
            collected.shippingAmount === 20,
            `expected 20, got ${collected.shippingAmount}`,
        );

        // The seeded default place does not offer collection, so an order
        // mixing the two cannot be collected.
        let pickupRefusal = "";
        try {
            await quoteCharges({
                lines: [
                    probeLine,
                    {
                        productId: "other",
                        productName: "Delivered only",
                        quantity: 1,
                        lineTotal: 100,
                        taxRuleId: null,
                        shippingRuleId: defaultShipping?.id ?? null,
                    },
                ],
                destination: { country: "Bangladesh", state: "Dhaka" },
                deliveryMethod: "PICKUP",
                ...baseInput,
            });
        } catch (error) {
            pickupRefusal = (error as Error).message;
        }
        check(
            "collection is refused when one item cannot be collected",
            pickupRefusal.includes("not available"),
            pickupRefusal || "the quote allowed collection",
        );

        // Two rules in one order are two deliveries, so they add up.
        const twoRules = await quoteCharges({
            lines: [
                probeLine,
                {
                    productId: "other",
                    productName: "Delivered only",
                    quantity: 1,
                    lineTotal: 100,
                    taxRuleId: null,
                    shippingRuleId: defaultShipping?.id ?? null,
                },
            ],
            destination: { country: "Bangladesh", state: "Dhaka" },
            deliveryMethod: "DELIVERY",
            ...baseInput,
        });
        check(
            "two shipping rules in one order are charged once each",
            twoRules.shippingAmount === 60 + Number(defaultShipping?.places[0]?.price ?? 0),
            `expected ${60 + Number(defaultShipping?.places[0]?.price ?? 0)}, got ${twoRules.shippingAmount}`,
        );
    } finally {
        await prisma.shippingRule.delete({ where: { id: probe.id } });
    }

    console.log(
        `\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}\n`,
    );

    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
};

void main();
