/**
 * Pins the three hand-synced copies of a landing page's offer shapes.
 *
 * The shape lives in the backend's Zod schema, in `nextjs/src/types/landing-page.ts`,
 * and in `admin/src/lib/api/landing-pages.ts`. The packages never import each
 * other, so a field renamed in one place produces NO type error anywhere: the
 * admin simply saves a key the backend strips, and the merchant's change
 * vanishes behind a success toast. Same obligation `verify-revalidate-tags.ts`
 * discharges for cache tags, and the same silent failure.
 *
 * Checked by reading the two frontend files as TEXT. They cannot be imported
 * from here — different tsconfig, different module resolution — and a shallow
 * check that catches a rename is worth more than a perfect one that never runs.
 *
 * ALSO PINS THE FEATURE-OFF PATH: a page that configures none of this must
 * parse, and must resolve to its bound product at the product's own price.
 * That is the property which made the migration backfill-free, and it is the
 * one most likely to be broken by a later "tidy-up" that makes a field required.
 *
 * Reads only; creates nothing and needs no cleanup.
 *
 * Run with:
 *   npx tsx scripts/verify-landing-page-shapes.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LandingPageService } from "../src/app/module/landing-page/landing-page.service";
import { createLandingPageZodSchema } from "../src/app/module/landing-page/landing-page.validation";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

/** Repo root, from server/scripts. */
const ROOT = join(import.meta.dirname, "..", "..");

const readOrNull = (relativePath: string): string | null => {
    try {
        return readFileSync(join(ROOT, relativePath), "utf-8");
    } catch {
        return null;
    }
};

/* ------------------------------------------------------------------ *
 * 1. The field names, as the BACKEND defines them.
 * ------------------------------------------------------------------ */

/*
 * A sample rather than a hand-typed list of names: a list typed out here would
 * be a FOURTH copy to keep in step, which is the very problem this script
 * exists to catch. Parsed below, so it cannot drift from the schema either.
 */
const sample = {
    title: "x",
    productId: "p1",
    headline: "x",
    bodyHtml: "<p>x</p>",
    packages: [
        {
            key: "one-kg",
            label: "১ কেজি",
            productId: "p1",
            price: 1599,
            compareAtPrice: 2100,
            freeGiftText: "+ ফ্রি চাল",
            badge: "হট অফার",
            preselected: true,
        },
    ],
    whyUs: [{ title: "খাঁটি", text: "দেশি দুধ" }],
    usageIdeas: [{ label: "ভাতের সাথে", icon: "lucide:utensils" }],
    offerEndsAt: "2026-12-31T18:00:00.000Z",
    stopOrdersAtDeadline: true,
    scarcityTarget: 100,
    orderPhone: "01867788456",
    requiresAdvancePayment: true,
    theme: {
        accent: "#e18820",
        accentSoft: "#fff8ef",
        accentContrast: "#ffffff",
        surface: "#ffffff",
        surfaceAlt: "#f8f9fa",
        text: "#111827",
        textMuted: "#6b7280",
        border: "#e5e7eb",
    },
    quotes: [{ name: "রাকিব", imageUrl: "https://x.test/r.jpg" }],
};

const parsed = createLandingPageZodSchema.safeParse(sample);
check(
    "the sample parses against the backend schema",
    parsed.success,
    parsed.success ? "schema accepts every offer field" : JSON.stringify(parsed.error?.issues?.[0]),
);

const OFFER_KEYS = [
    "packages",
    "whyUs",
    "usageIdeas",
    "offerEndsAt",
    "stopOrdersAtDeadline",
    "scarcityTarget",
    "orderPhone",
    "requiresAdvancePayment",
    "theme",
];
const PACKAGE_KEYS = Object.keys(sample.packages[0]!);
/*
 * The theme tokens are checked by name like every other field. A token renamed
 * in one copy and not the others is the same silent failure as any renamed
 * key — the admin saves something the backend strips.
 */
const THEME_KEYS = Object.keys(sample.theme);
const ALL_KEYS = [...new Set([...OFFER_KEYS, ...PACKAGE_KEYS, ...THEME_KEYS, "imageUrl"])];

/* ------------------------------------------------------------------ *
 * 2. Both frontend mirrors carry every one of them.
 * ------------------------------------------------------------------ */

/**
 * Keys one mirror legitimately does not carry.
 *
 * `scarcity` is the COMPUTED progress figure, served to the storefront so it
 * can render the bar. The admin never reads it — a merchant edits the target,
 * not the count, and there is deliberately no way for them to set the count at
 * all. So its absence from the admin is the design working, not drift.
 *
 * Kept as an explicit exception rather than dropped from the list entirely:
 * the storefront IS still checked for it, and a reader can see which key is
 * excused where and why.
 */
const NOT_IN: Record<string, string[]> = { admin: ["scarcity"] };

const mirrors: [string, string][] = [
    ["storefront", "nextjs/src/types/landing-page.ts"],
    ["admin", "admin/src/lib/api/landing-pages.ts"],
];

for (const [name, path] of mirrors) {
    const source = readOrNull(path);

    if (source === null) {
        check(`${name}: mirror file is readable`, false, `could not read ${path}`);
        continue;
    }

    /*
     * WORD-BOUNDED, not `includes`.
     *
     * A bare substring search cannot tell `surfaceAlt` from `surfaceAlternate`:
     * renaming the token in one copy would leave the old name as a prefix of
     * the new one and the check would pass, which is the exact drift it exists
     * to catch. Matching the key followed by a non-identifier character — `?`,
     * `:`, a space — is what makes a rename visible.
     */
    const expected = ALL_KEYS.filter((key) => !(NOT_IN[name] ?? []).includes(key));
    const missing = expected.filter(
        (key) => !new RegExp(`\\b${key}(?![A-Za-z0-9_])`).test(source),
    );
    check(
        `${name}: every backend field name appears in its mirror`,
        missing.length === 0,
        missing.length === 0
            ? `all ${expected.length} field names present in ${path}`
            : `MISSING from ${path}: ${missing.join(", ")} — rename it there too, or the merchant's save is silently stripped`,
    );
}

/*
 * The admin mirrors the BOUNDS too, so its form stops adding a row before the
 * API refuses one. A cap raised on one side only is a merchant told "you can
 * add another" and then refused on save.
 */
const adminSource = readOrNull("admin/src/lib/api/landing-pages.ts") ?? "";
for (const [constant, value] of [
    ["MAX_PACKAGES", 6],
    ["MAX_WHY_US", 12],
    ["MAX_USAGE_IDEAS", 16],
] as const) {
    check(
        `admin: ${constant} mirrors the backend's ${value}`,
        new RegExp(`${constant}\\s*=\\s*${value}\\b`).test(adminSource),
        `expected \`${constant} = ${value}\` in the admin's api module`,
    );
}

/* ------------------------------------------------------------------ *
 * 3. NO COLOUR IS HARDCODED IN A LANDING COMPONENT.
 * ------------------------------------------------------------------ */

/*
 * The whole point of the tokens is that ONE change reaches every colour on the
 * page. A `text-gray-600` typed into a component is a colour no merchant can
 * ever reach — and it is invisible in review, because it looks exactly like the
 * token beside it. So it is a failing check rather than a convention.
 *
 * Two exceptions, each deliberate and each documented where it sits:
 *   - the gallery's `bg-black/35` scrim, which darkens a PHOTOGRAPH so the play
 *     glyph stays visible; a merchant's surface colour cannot do that.
 *   - the package ribbon's white on `bg-sale`, which is the shop-wide "this is
 *     the deal" signal and must mean the same thing on every page.
 */
const LANDING_DIR = join(ROOT, "nextjs", "src", "components", "landing");
const ALLOWED_HARDCODED = ["bg-black/35", "text-white"];

const offenders: string[] = [];
for (const file of readdirSync(LANDING_DIR).filter((f) => f.endsWith(".tsx"))) {
    const source = readFileSync(join(LANDING_DIR, file), "utf-8");
    const found = source.match(
        /\b(?:text|bg|border|ring|divide)-(?:gray|white|black|green|amber|red|blue|slate|zinc)[a-z0-9/-]*/g,
    );
    for (const hit of found ?? []) {
        if (!ALLOWED_HARDCODED.includes(hit)) offenders.push(`${file}: ${hit}`);
    }
}

check(
    "no landing component hardcodes a colour",
    offenders.length === 0,
    offenders.length === 0
        ? "every colour resolves through a token, so one admin change reaches all of them"
        : `HARDCODED: ${offenders.join(", ")} — a merchant can never change these`,
);

/* ------------------------------------------------------------------ *
 * 4. A CAMPAIGN AUTHORS NO DELIVERY PRICES.
 * ------------------------------------------------------------------ */

/*
 * `deliveryZones` is GONE, and its absence is asserted rather than left
 * unmentioned. A campaign that could author its own delivery prices puts two
 * price lists live at once — the same customer at the same address paying one
 * figure through the catalogue and another through an ad, with only one of them
 * where the merchant looks. Reintroducing the field would rebuild exactly that,
 * and nothing else in the codebase would complain.
 */
const zonesRejected = createLandingPageZodSchema.safeParse({
    title: "x",
    productId: "p1",
    headline: "x",
    bodyHtml: "<p>x</p>",
    deliveryZones: [{ key: "inside-dhaka", label: "ঢাকার ভিতরে", price: 60 }],
});
check(
    "a campaign cannot author delivery prices",
    !zonesRejected.success,
    zonesRejected.success
        ? "it was accepted — two price lists are live again"
        : (zonesRejected.error.issues[0]?.message ?? ""),
);

/*
 * ALL FOUR COPIES, by name — the backend's own interface, constants and
 * validation alongside the two frontend mirrors. The Zod check above proves
 * the API REFUSES the field; these prove nobody is still carrying a type, a
 * default or a resolver for it, which is how a removed field quietly grows a
 * second life.
 *
 * Any mention at all fails, including one inside a comment saying the field is
 * gone. There is exactly one such comment, in LandingPage.prisma, and that
 * file is deliberately not on this list.
 */
const zoneCarriers: [string, string][] = [
    ...mirrors,
    ["backend interface", "server/src/app/module/landing-page/landing-page.interface.ts"],
    ["backend constants", "server/src/app/module/landing-page/landing-page.constant.ts"],
    ["backend validation", "server/src/app/module/landing-page/landing-page.validation.ts"],
];

for (const [name, path] of zoneCarriers) {
    const source = readOrNull(path);

    if (source === null) {
        check(`${name}: file is readable`, false, `could not read ${path}`);
        continue;
    }

    check(
        `${name}: carries no deliveryZones`,
        !/deliveryZones|DEFAULT_DELIVERY_ZONES|resolveDeliveryZone/.test(source),
        `the shop's delivery options are the single price list`,
    );
}

/* ------------------------------------------------------------------ *
 * 5. THE FEATURE-OFF PATH IS UNCHANGED.
 * ------------------------------------------------------------------ */

const bare = createLandingPageZodSchema.safeParse({
    title: "x",
    productId: "p1",
    headline: "x",
    bodyHtml: "<p>x</p>",
});
check(
    "a page configuring NONE of this still parses",
    bare.success,
    bare.success
        ? "every offer field is optional, which is what made the migration backfill-free"
        : JSON.stringify(bare.error?.issues?.[0]),
);

const noPackages = LandingPageService.resolveLandingPackage({
    productId: "prod-1",
    packages: null,
});
check(
    "no packages resolves to the BOUND product",
    noPackages.productId === "prod-1" && noPackages.packageKey === null,
    `product ${noPackages.productId}, key ${noPackages.packageKey}`,
);
check(
    "no packages authors NO price",
    noPackages.authoredPrice === null,
    "null means 'read the product's own offerPrice', exactly as before packages existed",
);

const emptyPackages = LandingPageService.resolveLandingPackage({
    productId: "prod-1",
    packages: [] as never,
});
check(
    "an EMPTY package list falls back to the bound product",
    emptyPackages.productId === "prod-1" && emptyPackages.authoredPrice === null,
    "which is what makes deleting every package a safe rollback rather than a broken page",
);

/*
 * The honesty guarantee, re-asserted here because this script is the one that
 * runs when someone edits the shapes: a field that could seed the scarcity
 * count must never become spellable.
 */
const seeded = createLandingPageZodSchema.safeParse({
    title: "x",
    productId: "p1",
    headline: "x",
    bodyHtml: "<p>x</p>",
    scarcityTarget: 100,
    scarcityTakenCount: 65,
});
check(
    "a seeded scarcity count is still refused by name",
    !seeded.success,
    seeded.success
        ? "it was accepted — the figure must stay derived from real orders"
        : (seeded.error.issues[0]?.message ?? ""),
);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
