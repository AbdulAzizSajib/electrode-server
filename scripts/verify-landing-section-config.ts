/**
 * Pins a landing page's stored section order.
 *
 * THE FIRST CHECK IS THE ONE THAT MATTERS. Every campaign that exists today has
 * `sectionConfig = NULL`, and null must keep meaning "never configured" — the
 * value the storefront resolves to the default order. A change that backfilled
 * the column, or that made the field required, would convert every live campaign
 * from "as it always was" into "deliberately configured this way", and nothing
 * would fail loudly when it happened. So: null stays null, and an update that
 * omits the key leaves what is there alone.
 *
 * The rest pins the validation. `sectionConfig` is a Json column, so MySQL
 * constrains none of its shape and `sectionConfigSchema` is the only gate. Each
 * rejection below is a way a malformed order could otherwise reach the column
 * and be read back as truth by the storefront.
 *
 * Imports the service and the schema DIRECTLY rather than going through HTTP —
 * the arrangement every verify script here uses, and the reason services must
 * never touch `req`/`res`.
 *
 * Creates `__verify_*`-prefixed rows and removes them in a `finally`.
 *
 * Run with:
 *   npx tsx scripts/verify-landing-section-config.ts
 */
import { prisma } from "../src/app/lib/prisma";
import { ProductStatus } from "../src/generated/prisma/client";
import { LandingPageService } from "../src/app/module/landing-page/landing-page.service";
import { sectionConfigSchema } from "../src/app/module/landing-page/landing-page.validation";
import {
    DEFAULT_LANDING_SECTION_ORDER,
    MAX_CUSTOM_SECTIONS,
} from "../src/app/module/landing-page/landing-page.constant";
import type { ILandingSectionConfigEntry } from "../src/app/module/landing-page/landing-page.interface";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

/** A shape the schema must REFUSE. The message is what the caller would see. */
const refuses = (label: string, value: unknown) => {
    const result = sectionConfigSchema.safeParse(value);
    check(
        label,
        !result.success,
        result.success
            ? "accepted — it should not have been"
            : `refused: ${result.error.issues[0]?.message}`,
    );
};

/**
 * Compares two stored orders the way the contract actually defines them.
 *
 * THE ARRAY ORDER IS THE DATA and is compared strictly. The KEY ORDER INSIDE
 * each entry is not: the column is JSON, and MySQL does not preserve the order
 * keys were written in within an object — it normalises them into its own.
 * (PostgreSQL's `jsonb` did the same thing, so this comparison needed no
 * change when the engine did.)
 * A raw JSON.stringify comparison therefore fails on a value that round-tripped
 * perfectly, which says nothing about the code and hides the one difference
 * that would matter.
 */
const sameOrder = (a: unknown, b: unknown): boolean => {
    const normalise = (value: unknown): string =>
        JSON.stringify(
            (value as ILandingSectionConfigEntry[]).map((entry) =>
                Object.fromEntries(
                    Object.entries(entry).sort(([x], [y]) => x.localeCompare(y)),
                ),
            ),
        );

    try {
        return normalise(a) === normalise(b);
    } catch {
        return false;
    }
};

/** A shape the schema must ACCEPT, unchanged. */
const accepts = (label: string, value: unknown) => {
    const result = sectionConfigSchema.safeParse(value);
    check(
        label,
        result.success,
        result.success ? "accepted" : `refused: ${result.error.issues[0]?.message}`,
    );
};

const PREFIX = "__verify_lp_sections";

const orderForm = {
    fields: {
        fullName: { label: "নাম", required: true },
        phone: { label: "মোবাইল" },
        address: { label: "ঠিকানা" },
    },
    submitLabel: "অর্ডার",
};

const main = async () => {
    const product = await prisma.product.create({
        data: {
            name: `${PREFIX} product`,
            slug: `${PREFIX}-product`,
            offerPrice: 900,
            sellingPrice: 1200,
            status: ProductStatus.ACTIVE,
        },
        select: { id: true },
    });

    /*
     * Deliberately NOT the default order: a stored order that happened to match
     * the default would pass every check below even if the column were being
     * ignored and the default substituted on read.
     */
    const storedOrder: ILandingSectionConfigEntry[] = [
        { key: "HERO", enabled: true },
        { key: "ORDER_FORM", enabled: true },
        { key: "QUOTES", enabled: true },
        { key: "FAQS", enabled: false },
        { key: "CUSTOM", enabled: true, id: "guarantee", heading: "গ্যারান্টি", layout: "HIGHLIGHT" },
        { key: "CTA", enabled: true },
        { key: "HIGHLIGHTS", enabled: true },
        { key: "CTA", enabled: true },
    ];

    let untouched: { id: string } | null = null;
    let configured: { id: string } | null = null;

    try {
        // ── 1. Null means "never configured", and stays null ────────────────
        untouched = await LandingPageService.createLandingPage(undefined, {
            title: `${PREFIX} untouched`,
            productId: product.id,
            headline: "শিরোনাম",
            bodyHtml: "<p>body</p>",
            orderForm,
        } as never);

        const afterCreate = await prisma.landingPage.findUnique({
            where: { id: untouched!.id },
            select: { sectionConfig: true },
        });

        check(
            "a page created without a section order stores NULL",
            afterCreate?.sectionConfig === null,
            `sectionConfig = ${JSON.stringify(afterCreate?.sectionConfig)} — null is what the storefront resolves to the default order`,
        );

        // An unrelated PATCH must not invent an order for a page that has none.
        await LandingPageService.updateLandingPage(undefined, untouched!.id, {
            headline: "নতুন শিরোনাম",
        } as never);

        const afterUnrelatedPatch = await prisma.landingPage.findUnique({
            where: { id: untouched!.id },
            select: { sectionConfig: true },
        });

        check(
            "an unrelated update leaves NULL as NULL",
            afterUnrelatedPatch?.sectionConfig === null,
            `sectionConfig = ${JSON.stringify(afterUnrelatedPatch?.sectionConfig)} — a page that never reached the editor must keep rendering the default order`,
        );

        // ── 2. A stored order round-trips EXACTLY ──────────────────────────
        configured = await LandingPageService.createLandingPage(undefined, {
            title: `${PREFIX} configured`,
            productId: product.id,
            headline: "শিরোনাম",
            bodyHtml: "<p>body</p>",
            orderForm,
            sectionConfig: storedOrder,
        } as never);

        const stored = await prisma.landingPage.findUnique({
            where: { id: configured!.id },
            select: { sectionConfig: true },
        });

        check(
            "a stored order comes back in exactly the sequence sent",
            sameOrder(stored?.sectionConfig, storedOrder),
            "order is the data — never sorted, normalised or re-grouped",
        );

        const keysBack = (stored?.sectionConfig as ILandingSectionConfigEntry[]).map((e) => e.key);
        check(
            "the stored order is NOT silently replaced by the default",
            JSON.stringify(keysBack) !== JSON.stringify([...DEFAULT_LANDING_SECTION_ORDER]),
            `stored ${keysBack.join(" → ")}`,
        );

        // ── 3. Omitting the key leaves an existing order untouched ──────────
        await LandingPageService.updateLandingPage(undefined, configured!.id, {
            headline: "আরেকটি শিরোনাম",
        } as never);

        const afterOmit = await prisma.landingPage.findUnique({
            where: { id: configured!.id },
            select: { sectionConfig: true },
        });

        check(
            "an update omitting sectionConfig leaves the stored order alone",
            sameOrder(afterOmit?.sectionConfig, storedOrder),
            "omitted means 'leave unchanged' — this is what stops the landing page form clobbering the section editor's work",
        );

        // ── 4. A disabled section keeps its content ────────────────────────
        const disabled = (afterOmit?.sectionConfig as ILandingSectionConfigEntry[]).find(
            (entry) => entry.key === "FAQS",
        );
        check(
            "a disabled section is stored as disabled, not removed",
            disabled !== undefined && disabled.enabled === false,
            "switching a section off must not delete it — re-enabling restores exactly what was there",
        );

        const custom = (afterOmit?.sectionConfig as ILandingSectionConfigEntry[]).find(
            (entry) => entry.key === "CUSTOM",
        );
        check(
            "a custom section keeps its id and its own content",
            custom?.id === "guarantee" && custom?.heading === "গ্যারান্টি",
            `id=${custom?.id} heading=${custom?.heading} — position is not an identity`,
        );

        // ── 5. A duplicate carries the layout ──────────────────────────────
        const copy = await LandingPageService.duplicateLandingPage(undefined, configured!.id);

        try {
            const copied = await prisma.landingPage.findUnique({
                where: { id: copy.id },
                select: { sectionConfig: true },
            });

            check(
                "a duplicated page carries its section order",
                sameOrder(copied?.sectionConfig, storedOrder),
                "a copy that reverted to the default order would be a different page wearing the same content",
            );
        } finally {
            await prisma.landingPage.deleteMany({ where: { id: copy.id } });
        }

        // ── 6. Validation — the only gate on this column ───────────────────
        accepts("the default order", DEFAULT_LANDING_SECTION_ORDER.map((key) => ({ key, enabled: true })));
        accepts("a reordered list with a section switched off", storedOrder);

        refuses("an unknown section key", [
            { key: "HERO", enabled: true },
            { key: "ORDER_FORM", enabled: true },
            { key: "NOT_A_SECTION", enabled: true },
        ]);
        refuses("two custom sections sharing one id", [
            { key: "HERO", enabled: true },
            { key: "ORDER_FORM", enabled: true },
            { key: "CUSTOM", enabled: true, id: "same", heading: "One" },
            { key: "CUSTOM", enabled: true, id: "same", heading: "Two" },
        ]);
        refuses("a custom section with no id", [
            { key: "HERO", enabled: true },
            { key: "ORDER_FORM", enabled: true },
            { key: "CUSTOM", enabled: true, heading: "Anonymous" },
        ]);
        refuses("a custom section with neither heading nor body", [
            { key: "HERO", enabled: true },
            { key: "ORDER_FORM", enabled: true },
            { key: "CUSTOM", enabled: true, id: "empty" },
        ]);
        refuses("a built-in section carrying custom content", [
            { key: "HERO", enabled: true },
            { key: "ORDER_FORM", enabled: true },
            { key: "FAQS", enabled: true, heading: "not mine" },
        ]);
        refuses("a repeated non-repeatable key", [
            { key: "HERO", enabled: true },
            { key: "ORDER_FORM", enabled: true },
            { key: "QUOTES", enabled: true },
            { key: "QUOTES", enabled: true },
        ]);
        refuses("more custom sections than the limit", [
            { key: "HERO", enabled: true },
            { key: "ORDER_FORM", enabled: true },
            ...Array.from({ length: MAX_CUSTOM_SECTIONS + 1 }, (_, i) => ({
                key: "CUSTOM",
                enabled: true,
                id: `c${i}`,
                heading: `H${i}`,
            })),
        ]);
        refuses("an unrecognised field (the entry is strict)", [
            { key: "HERO", enabled: true, scarcityTakenCount: 65 },
        ]);
        refuses("a malformed entry with no `enabled`", [{ key: "HERO" }]);

        /*
         * THE PAGE MUST KEEP WHAT MAKES IT A PAGE. Enforced here as well as
         * hidden in the admin, because a warning in the admin is dismissed once
         * and the blank page stays live while the ads run.
         */
        refuses("an order with no HERO at all", [{ key: "FAQS", enabled: true }]);
        refuses("an order with HERO switched off", [
            { key: "HERO", enabled: false },
            { key: "ORDER_FORM", enabled: true },
            { key: "FAQS", enabled: true },
        ]);

        /*
         * The order form is required on exactly the same terms as the product,
         * and is the worse of the two to lose: a page with a product on it and
         * no form still looks like it works.
         */
        refuses("an order with no ORDER_FORM at all", [
            { key: "HERO", enabled: true },
            { key: "FAQS", enabled: true },
        ]);
        refuses("an order with ORDER_FORM switched off", [
            { key: "HERO", enabled: true },
            { key: "ORDER_FORM", enabled: false },
            { key: "FAQS", enabled: true },
        ]);

        // And the service must refuse it too, not just the schema in isolation.
        const rejected = await LandingPageService.updateLandingPage(undefined, configured!.id, {
            sectionConfig: [
                { key: "HERO", enabled: true },
                { key: "ORDER_FORM", enabled: true },
                { key: "QUOTES", enabled: true },
            ],
        } as never)
            .then(() => null)
            .catch((error: Error) => error.message);

        check(
            "a well-formed order still saves through the service",
            rejected === null,
            rejected === null ? "stored" : `refused: ${rejected}`,
        );
    } finally {
        const ids = [untouched?.id, configured?.id].filter(Boolean) as string[];
        if (ids.length) {
            await prisma.order.deleteMany({ where: { landingPageId: { in: ids } } });
            await prisma.landingPage.deleteMany({ where: { id: { in: ids } } });
        }
        await prisma.landingPage.deleteMany({ where: { title: { startsWith: PREFIX } } });
        await prisma.stock.deleteMany({ where: { productId: product.id } });
        await prisma.product.deleteMany({ where: { id: product.id } });
    }
};

main()
    .then(() => {
        console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
        process.exit(failures === 0 ? 0 : 1);
    })
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
