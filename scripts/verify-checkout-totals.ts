/**
 * Checkout totals verification, for the delivery-option pricing path.
 *
 * Replaces the shipping-rule version of this script wholesale. The old one
 * asserted destination matching — region beats country beats catch-all, an
 * unmatched destination refused, delivery summed once per distinct rule in the
 * basket. Every one of those behaviours is gone by design, so the checks are
 * not adapted but replaced: delivery is now ONE option the shopper picked,
 * charged ONCE, and nothing is matched against an address.
 *
 * Read-only apart from the store's own settings, which it restores. Run with:
 *   npm run verify:checkout
 */
import { prisma } from "../src/app/lib/prisma";
import { quoteCharges, type IPricingLine } from "../src/app/module/order/order.pricing";
import { SINGLETON_ID } from "../src/app/module/store-setting/store-setting.constant";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

/** A line with no tax rule, so delivery is the only thing under test. */
const line = (lineTotal: number, id = "probe"): IPricingLine => ({
    productId: id,
    productName: `Probe ${id}`,
    quantity: 1,
    lineTotal,
    taxRuleId: null,
});

const main = async () => {
    const [storeSetting, orders, products] = await Promise.all([
        prisma.storeSetting.findFirst(),
        prisma.order.findMany({ include: { items: true } }),
        prisma.product.findMany({ select: { id: true, name: true, price: true, taxRuleId: true } }),
    ]);

    const freeShippingThreshold =
        storeSetting?.freeShippingThreshold == null
            ? null
            : Number(storeSetting.freeShippingThreshold);

    console.log(`\nStore: free-shipping ${freeShippingThreshold ?? "off"}`);
    console.log(`Products: ${products.length}, past orders: ${orders.length}\n`);

    /* ------------------------------------------------------------------ *
     * 1. Past orders keep the amount they were charged.
     *
     * Not a replay: a historical order's delivery CANNOT be recomputed, and
     * that is the point. Its option may since have been renamed, repriced or
     * deleted, and the order is supposed to be immune to all three. So the
     * check is that the captured columns are self-consistent, not that they
     * still agree with the current option list.
     * ------------------------------------------------------------------ */
    let shopOrders = 0;
    for (const order of orders) {
        // Landing-page orders and pre-change orders legitimately carry none.
        if (!order.deliveryOptionKey) continue;
        shopOrders += 1;

        check(
            `order ${order.orderNumber} captured its option`,
            Boolean(order.deliveryOptionLabel) && order.deliveryMethod !== null,
            `key ${order.deliveryOptionKey}, label ${order.deliveryOptionLabel ?? "(none)"}, method ${order.deliveryMethod ?? "(none)"}`,
        );

        const total =
            Number(order.subtotal) +
            Number(order.shippingAmount) +
            Number(order.taxAmount) -
            Number(order.discountAmount);
        check(
            `order ${order.orderNumber} total still adds up`,
            Math.abs(total - Number(order.totalAmount)) < 0.01,
            `stored ${Number(order.totalAmount)}, recomputed ${Math.round(total * 100) / 100}`,
        );
    }

    if (shopOrders === 0) {
        console.log("(no orders carry a delivery option yet — the cases below stand in)\n");
    }

    /* ------------------------------------------------------------------ *
     * 2. The pricing path itself, against a known option list.
     *
     * The store's real config is swapped for a probe list and restored in the
     * `finally` below, so these assertions do not depend on how the merchant
     * happens to have configured delivery today.
     * ------------------------------------------------------------------ */
    const storedConfig = storeSetting?.checkoutConfig ?? null;

    const baseConfig = {
        fields: {
            fullName: { show: true, required: true },
            phone: { show: true, required: true },
            addressLine1: { show: true, required: true },
            addressLine2: { show: true, required: false },
            city: { show: true, required: true },
            postalCode: { show: true, required: false },
        },
        showCouponBox: true,
        showOrderNote: true,
        allowGuestCheckout: true,
        notice: "",
    };

    const setDelivery = async (delivery: unknown) => {
        await prisma.storeSetting.update({
            where: { id: SINGLETON_ID },
            data: { checkoutConfig: { ...baseConfig, delivery } as never },
        });
    };

    const base = {
        discountAmount: 0,
        couponWaivesShipping: false,
        freeShippingThreshold: null,
    };

    try {
        await setDelivery({
            offersPickup: true,
            options: [
                { key: "inside-dhaka", label: "Inside Dhaka", kind: "DELIVERY", price: 60, days: 2 },
                { key: "outside-dhaka", label: "Outside Dhaka", kind: "DELIVERY", price: 120, days: 4 },
                { key: "mirpur-shop", label: "Mirpur shop", kind: "PICKUP", price: 20, days: 1 },
            ],
        });

        const inside = await quoteCharges({
            lines: [line(1000)],
            deliveryOptionKey: "inside-dhaka",
            ...base,
        });
        check(
            "the chosen option is charged at its own price",
            inside.shippingAmount === 60,
            `expected 60, got ${inside.shippingAmount}`,
        );
        check(
            "the resolved option is reported back for the order to capture",
            inside.delivery?.optionKey === "inside-dhaka" &&
                inside.delivery?.optionLabel === "Inside Dhaka" &&
                inside.delivery?.method === "DELIVERY",
            JSON.stringify(inside.delivery),
        );

        // The whole point of the change: the basket no longer influences it.
        const manyLines = await quoteCharges({
            lines: [line(1000, "a"), line(2000, "b"), line(3000, "c")],
            deliveryOptionKey: "inside-dhaka",
            ...base,
        });
        check(
            "delivery is charged ONCE however many products are in the basket",
            manyLines.shippingAmount === 60,
            `expected 60 for three lines, got ${manyLines.shippingAmount}`,
        );

        const pickup = await quoteCharges({
            lines: [line(1000)],
            deliveryOptionKey: "mirpur-shop",
            ...base,
        });
        check(
            "a pickup point is priced from the option, not from a delivery price",
            pickup.shippingAmount === 20 && pickup.delivery?.method === "PICKUP",
            `expected 20/PICKUP, got ${pickup.shippingAmount}/${pickup.delivery?.method}`,
        );

        // Collection is a different service, not a discounted delivery — a
        // waiver that zeroes delivery must not give the collection fee away.
        const waivedPickup = await quoteCharges({
            lines: [line(1000)],
            deliveryOptionKey: "mirpur-shop",
            ...base,
            couponWaivesShipping: true,
        });
        check(
            "a free-delivery coupon does not waive a collection fee",
            waivedPickup.shippingAmount === 20,
            `expected 20, got ${waivedPickup.shippingAmount}`,
        );

        const waivedDelivery = await quoteCharges({
            lines: [line(1000)],
            deliveryOptionKey: "inside-dhaka",
            ...base,
            couponWaivesShipping: true,
        });
        check(
            "a free-delivery coupon does waive a delivery charge, and says what it was",
            waivedDelivery.shippingAmount === 0 && waivedDelivery.shippingBeforeWaiver === 60,
            `charged ${waivedDelivery.shippingAmount}, before waiver ${waivedDelivery.shippingBeforeWaiver}`,
        );

        let unknown = "";
        try {
            await quoteCharges({ lines: [line(1000)], deliveryOptionKey: "no-such-option", ...base });
        } catch (error) {
            unknown = (error as Error).message;
        }
        check(
            "an unknown option key is refused, not charged 0",
            unknown.includes("no longer available") && unknown.includes("choose again"),
            unknown || "the quote returned a price",
        );

        // Switching collection off must be enforced in pricing, not only in the
        // UI — otherwise an older request body could still reach a pickup price.
        await setDelivery({
            offersPickup: false,
            options: [
                { key: "inside-dhaka", label: "Inside Dhaka", kind: "DELIVERY", price: 60, days: 2 },
                { key: "mirpur-shop", label: "Mirpur shop", kind: "PICKUP", price: 20, days: 1 },
            ],
        });

        let pickupOff = "";
        try {
            await quoteCharges({ lines: [line(1000)], deliveryOptionKey: "mirpur-shop", ...base });
        } catch (error) {
            pickupOff = (error as Error).message;
        }
        check(
            "a pickup point is refused while collection in person is switched off",
            pickupOff.includes("not being offered"),
            pickupOff || "the quote allowed collection",
        );

        // A store that has configured nothing must refuse, and must say it is a
        // store setup problem rather than blaming the shopper's input.
        await setDelivery({ offersPickup: false, options: [] });

        let unconfigured = "";
        try {
            await quoteCharges({ lines: [line(1000)], deliveryOptionKey: "inside-dhaka", ...base });
        } catch (error) {
            unconfigured = (error as Error).message;
        }
        check(
            "a store with no delivery options refuses, as a configuration problem",
            unconfigured.includes("has not set up delivery"),
            unconfigured || "the quote returned a price",
        );

        /* -------------------------------------------------------------- *
         * 3. A landing-page order is priced by its own zone and is
         *    unaffected by any of the above — including by the empty list
         *    still in force here, which is the strongest form of the check.
         * -------------------------------------------------------------- */
        const override = await quoteCharges({
            lines: [line(1000)],
            ...base,
            shippingOverride: { amount: 99, label: "ঢাকার ভিতরে" },
        });
        check(
            "a landing-page order prices from its own zone even with no store options",
            override.shippingAmount === 99 && override.delivery === null,
            `charged ${override.shippingAmount}, delivery ${JSON.stringify(override.delivery)}`,
        );

        const overrideWaived = await quoteCharges({
            lines: [line(100000)],
            ...base,
            couponWaivesShipping: true,
            freeShippingThreshold: 1,
            shippingOverride: { amount: 99, label: "ঢাকার ভিতরে" },
        });
        check(
            "no waiver applies to a landing page's own delivery charge",
            overrideWaived.shippingAmount === 99,
            `expected 99, got ${overrideWaived.shippingAmount}`,
        );
    } finally {
        // Put the merchant's real configuration back, whatever happened above.
        if (storeSetting) {
            await prisma.storeSetting.update({
                where: { id: SINGLETON_ID },
                data: { checkoutConfig: storedConfig as never },
            });
        }
    }

    console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}\n`);

    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
};

void main();
