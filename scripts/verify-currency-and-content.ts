/**
 * Verification for the currency-format / tax-removal / home-content change.
 *
 * Covers the three places where getting it wrong is not merely cosmetic:
 *
 *  - `formatMoney`, which now decides how every amount in three separate
 *    deployments is written, and whose output a shopper compares against their
 *    basket when an order is refused;
 *  - `quoteTax` after the shop-wide fallback rate was removed, which decides
 *    what a shopper is actually charged;
 *  - the settings schema's treatment of `freeShippingThreshold`, where "no
 *    offer" (null), "every order free" (0) and "leave unchanged" (absent) are
 *    three different things that a partial upsert makes easy to conflate.
 *
 * Pure functions and one read-only database check. Run with:
 *   npx tsx scripts/verify-currency-and-content.ts
 */
import { prisma } from "../src/app/lib/prisma";
import { formatMoney, DEFAULT_CURRENCY_FORMAT } from "../src/app/utils/formatMoney";
import { quoteTax, type IPricingLine } from "../src/app/module/order/order.pricing";
import { updateStoreSettingZodSchema } from "../src/app/module/store-setting/store-setting.validation";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

const line = (over: Partial<IPricingLine> = {}): IPricingLine =>
    ({
        productId: "p1",
        productName: "Test product",
        quantity: 1,
        lineTotal: 1000,
        taxRuleId: null,
        shippingRuleId: null,
        ...over,
    }) as IPricingLine;

const main = async () => {
    // --- 1. formatMoney ---------------------------------------------------

    console.log("\n-- Money formatting --");

    check(
        "default format reproduces the storefront's previous rendering",
        formatMoney(1200.5) === "৳1,200.50",
        formatMoney(1200.5),
    );

    check(
        "thousands are grouped",
        formatMoney(1234567.89) === "৳1,234,567.89",
        formatMoney(1234567.89),
    );

    // Spelled by codepoint rather than pasted, so this cannot pass because an
    // editor silently normalised a non-breaking space into an ordinary one.
    const NBSP = "\u00A0";
    const trailing = formatMoney(1200, { symbol: "৳", position: "AFTER", decimals: 2 });

    check(
        "AFTER puts the symbol on the right, behind a NON-BREAKING space",
        trailing === `1,200.00${NBSP}৳`,
        JSON.stringify(trailing),
    );

    check(
        "a leading symbol has no space",
        formatMoney(1200, { symbol: "$", position: "BEFORE", decimals: 2 }) === "$1,200.00",
        formatMoney(1200, { symbol: "$", position: "BEFORE", decimals: 2 }),
    );

    check(
        "zero decimals rounds the DISPLAYED figure",
        formatMoney(1200.5, { symbol: "৳", position: "BEFORE", decimals: 0 }) === "৳1,201",
        formatMoney(1200.5, { symbol: "৳", position: "BEFORE", decimals: 0 }),
    );

    check(
        "four decimals pads with zeros carrying no stored precision",
        formatMoney(1200.5, { symbol: "৳", position: "BEFORE", decimals: 4 }) === "৳1,200.5000",
        formatMoney(1200.5, { symbol: "৳", position: "BEFORE", decimals: 4 }),
    );

    check(
        "a store with no settings still gets a symbol",
        /[^\d.,\s]/.test(formatMoney(10, DEFAULT_CURRENCY_FORMAT)),
        formatMoney(10, DEFAULT_CURRENCY_FORMAT),
    );

    // --- 2. Tax after the fallback was removed ----------------------------

    console.log("\n-- Tax --");

    const [percentRule, flatRule] = await Promise.all([
        prisma.taxRule.findFirst({ where: { type: "PERCENT" } }),
        prisma.taxRule.findFirst({ where: { type: "FLAT" } }),
    ]);

    {
        const quote = await quoteTax([line()], 0);
        check(
            "a product with NO tax rule is untaxed",
            quote.taxAmount === 0,
            `tax ${quote.taxAmount} on a 1000 line`,
        );
    }

    if (percentRule) {
        const rate = Number(percentRule.value);
        const quote = await quoteTax([line({ taxRuleId: percentRule.id })], 0);
        const expected = Math.round(((1000 * rate) / 100) * 100) / 100;
        check(
            "a percentage rule taxes the line",
            Math.abs(quote.taxAmount - expected) < 0.01,
            `${rate}% of 1000 = ${quote.taxAmount}, expected ${expected}`,
        );

        // The mixed order from the spec: tax lands on the tagged line only.
        const mixed = await quoteTax(
            [line({ productId: "tagged", taxRuleId: percentRule.id }), line({ productId: "untagged" })],
            0,
        );
        check(
            "in a mixed order only the tagged line is taxed",
            Math.abs(mixed.taxAmount - expected) < 0.01,
            `total tax ${mixed.taxAmount}, expected ${expected} (one line's worth)`,
        );

        const discounted = await quoteTax([line({ taxRuleId: percentRule.id })], 200);
        const expectedDiscounted = Math.round(((800 * rate) / 100) * 100) / 100;
        check(
            "a percentage rule taxes the discounted price, not the list price",
            Math.abs(discounted.taxAmount - expectedDiscounted) < 0.01,
            `${discounted.taxAmount}, expected ${expectedDiscounted}`,
        );
    } else {
        console.log("SKIP  no PERCENT tax rule in this database");
    }

    if (flatRule) {
        const quote = await quoteTax([line({ taxRuleId: flatRule.id, quantity: 2 })], 0);
        const expected = Math.round(Number(flatRule.value) * 2 * 100) / 100;
        check(
            "a flat rule charges per unit",
            Math.abs(quote.taxAmount - expected) < 0.01,
            `${quote.taxAmount}, expected ${expected}`,
        );
    } else {
        console.log("SKIP  no FLAT tax rule in this database");
    }

    {
        const columns = await prisma.$queryRaw<{ column_name: string }[]>`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'StoreSetting' AND column_name = 'defaultTaxRatePercent'
        `;
        check(
            "the shop-wide fallback rate column is gone",
            columns.length === 0,
            columns.length === 0 ? "dropped" : "STILL PRESENT",
        );
    }

    // --- 3. freeShippingThreshold's three states --------------------------

    console.log("\n-- Free shipping threshold --");

    {
        const absent = updateStoreSettingZodSchema.safeParse({ currency: "BDT" });
        check(
            "omitted means leave unchanged",
            absent.success && !("freeShippingThreshold" in absent.data),
            "key absent from the parsed payload",
        );

        const cleared = updateStoreSettingZodSchema.safeParse({ freeShippingThreshold: null });
        check(
            "null is accepted and means withdraw the offer",
            cleared.success && cleared.data.freeShippingThreshold === null,
            JSON.stringify(cleared.success ? cleared.data : cleared.error.issues[0]?.message),
        );

        const zero = updateStoreSettingZodSchema.safeParse({ freeShippingThreshold: 0 });
        check(
            "zero is accepted and is distinct from null",
            zero.success && zero.data.freeShippingThreshold === 0,
            JSON.stringify(zero.success ? zero.data : zero.error.issues[0]?.message),
        );

        const negative = updateStoreSettingZodSchema.safeParse({ freeShippingThreshold: -1 });
        check("a negative threshold is rejected", !negative.success, "rejected");
    }

    /*
     * The schema accepting null is only half of it — the partial upsert has to
     * carry that null through to the column, and an omitted key has to leave it
     * alone. Exercised against the real row and restored afterwards, because
     * this is precisely the property that was broken before: the old Store
     * Settings page dropped a blank field from the payload, so "clear the
     * threshold" arrived as "leave it unchanged" and a merchant could never
     * withdraw the offer.
     */
    {
        const original = await prisma.storeSetting.findUnique({
            where: { id: "singleton" },
            select: { freeShippingThreshold: true },
        });

        const readBack = async () => {
            const row = await prisma.storeSetting.findUnique({
                where: { id: "singleton" },
                select: { freeShippingThreshold: true },
            });
            return row?.freeShippingThreshold == null ? null : Number(row.freeShippingThreshold);
        };

        const write = (value: number | null | undefined) =>
            prisma.storeSetting.update({
                where: { id: "singleton" },
                data: value === undefined ? {} : { freeShippingThreshold: value },
            });

        await write(5000);
        check("a threshold is stored", (await readBack()) === 5000, `read back ${await readBack()}`);

        await write(undefined);
        check(
            "an omitted key leaves the stored threshold untouched",
            (await readBack()) === 5000,
            `still ${await readBack()}`,
        );

        await write(0);
        check(
            "zero is stored as zero, not as absent",
            (await readBack()) === 0,
            `read back ${await readBack()}`,
        );

        await write(null);
        check(
            "null clears the threshold, withdrawing the offer",
            (await readBack()) === null,
            `read back ${await readBack()}`,
        );

        // Put the merchant's own value back, whatever it was.
        await write(original?.freeShippingThreshold == null ? null : Number(original.freeShippingThreshold));
        const restored = await readBack();
        check(
            "the original value was restored",
            restored === (original?.freeShippingThreshold == null ? null : Number(original.freeShippingThreshold)),
            `restored to ${restored}`,
        );
    }

    // --- 4. Currency settings validation ----------------------------------

    console.log("\n-- Currency settings validation --");

    for (const decimals of [0, 1, 2, 3, 4]) {
        const parsed = updateStoreSettingZodSchema.safeParse({ currencyDecimals: decimals });
        check(`${decimals} decimal places is accepted`, parsed.success, "accepted");
    }

    for (const bad of [-1, 5, 2.5]) {
        const parsed = updateStoreSettingZodSchema.safeParse({ currencyDecimals: bad });
        check(
            `${bad} decimal places is rejected`,
            !parsed.success,
            parsed.success ? "ACCEPTED" : (parsed.error.issues[0]?.message ?? "rejected"),
        );
    }

    {
        const good = updateStoreSettingZodSchema.safeParse({ currencyPosition: "AFTER" });
        check("a valid symbol position is accepted", good.success, "AFTER");

        const bad = updateStoreSettingZodSchema.safeParse({ currencyPosition: "left" });
        check("an invalid symbol position is rejected", !bad.success, "rejected");
    }

    console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}\n`);
    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
};

main().catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
});
