/**
 * Checks the rules a home page section's LAYOUT obeys on the way in and on the
 * way out.
 *
 * Why this script exists rather than a comment: the failure this guards is
 * silent. `reconcileHomeConfig` REBUILDS each section entry rather than passing
 * it through, so a `variant` that is not carried explicitly through the map and
 * both rebuild paths is dropped on the way out — the merchant's choice saves,
 * persists correctly in the column, and is gone on the very next read. Nothing
 * throws, nothing logs, and every manual test that does not reload the page
 * passes. See openspec/changes/add-hero-section-variants, design.md Decision 4.
 *
 * STATIC AND DB-FREE, like verify-postman-routes.ts: it imports the validation
 * schema and the reconciler and calls them directly, so it runs in CI, on a
 * laptop with no database, and before any migration.
 *
 * Run with: npx tsx scripts/verify-hero-section-variants.ts
 */
import {
    DEFAULT_HOME_CONFIG,
    HERO_VARIANTS,
    HOME_SECTION_KEYS,
    resolveSectionVariant,
    type HomeSectionConfig,
} from "../src/app/module/store-setting/store-setting.constant";
import { homeConfigSchema } from "../src/app/module/store-setting/store-setting.validation";
import { reconcileHomeConfig } from "../src/app/module/store-setting/store-setting.service";

const DEFAULT_VARIANT = HERO_VARIANTS[0];

let failures = 0;

const check = (name: string, condition: boolean, detail?: string) => {
    if (condition) {
        console.log(`  ok   ${name}`);
        return;
    }
    failures += 1;
    console.error(`  FAIL ${name}${detail ? `\n         ${detail}` : ""}`);
};

const equal = (name: string, actual: unknown, expected: unknown) =>
    check(
        name,
        JSON.stringify(actual) === JSON.stringify(expected),
        `expected ${JSON.stringify(expected)}\n         actual   ${JSON.stringify(actual)}`,
    );

/** The HERO entry of a reconciled list. */
const hero = (config: HomeSectionConfig[]) => config.find((section) => section.key === "HERO");

/** A stored list in the shape a row written before layouts existed carries. */
const legacyStored = HOME_SECTION_KEYS.map((key) => ({ key, enabled: true }));

console.log("\nresolveSectionVariant");

equal("absent resolves to the default", resolveSectionVariant("HERO", undefined), DEFAULT_VARIANT);
equal(
    "unrecognised string resolves to the default",
    resolveSectionVariant("HERO", "NOT_A_LAYOUT"),
    DEFAULT_VARIANT,
);
equal("null resolves to the default", resolveSectionVariant("HERO", null), DEFAULT_VARIANT);
equal("a non-string resolves to the default", resolveSectionVariant("HERO", 7), DEFAULT_VARIANT);

for (const variant of HERO_VARIANTS) {
    equal(`${variant} resolves to itself`, resolveSectionVariant("HERO", variant), variant);
}

equal(
    "a section that offers no layout resolves to undefined",
    resolveSectionVariant("BRAND_BAR", undefined),
    undefined,
);
equal(
    "a layout on a section that offers none is still undefined",
    resolveSectionVariant("BRAND_BAR", "SPLIT_THREE"),
    undefined,
);

console.log("\nreconcileHomeConfig — resolution");

{
    const reconciled = reconcileHomeConfig(legacyStored);

    equal("a row that predates layouts reads as the default", hero(reconciled)?.variant, DEFAULT_VARIANT);
    check(
        "every other section carries no variant KEY at all",
        reconciled
            .filter((section) => section.key !== "HERO")
            .every((section) => !("variant" in section)),
        "a section that offers no layout must omit the key, not set it to undefined",
    );
}

{
    const reconciled = reconcileHomeConfig(null);
    equal("a non-array stored value still resolves the layout", hero(reconciled)?.variant, DEFAULT_VARIANT);
}

{
    const stored = legacyStored.map((section) =>
        section.key === "HERO" ? { ...section, variant: "NOT_A_LAYOUT" } : section,
    );
    equal(
        "a withdrawn layout falls back to the default",
        hero(reconcileHomeConfig(stored))?.variant,
        DEFAULT_VARIANT,
    );
}

{
    // HERO absent entirely — the splice path, which is the second rebuild and
    // the one most easily forgotten.
    const stored = legacyStored.filter((section) => section.key !== "HERO");
    const reconciled = reconcileHomeConfig(stored);

    equal("a spliced-in HERO carries the default layout", hero(reconciled)?.variant, DEFAULT_VARIANT);
    equal("and is spliced at the front, as the registry orders it", reconciled[0]?.key, "HERO");
}

console.log("\nreconcileHomeConfig — the round trip (the silent-drop guard)");

for (const variant of HERO_VARIANTS) {
    const stored = legacyStored.map((section) =>
        section.key === "HERO" ? { ...section, variant } : section,
    );

    const parsed = homeConfigSchema.safeParse(stored);
    check(`${variant} passes validation`, parsed.success, JSON.stringify(parsed.error?.issues));

    equal(
        `${variant} survives reconciliation`,
        hero(reconcileHomeConfig(parsed.success ? parsed.data : stored))?.variant,
        variant,
    );
}

console.log("\nreconcileHomeConfig — an untouched store is unaffected");

{
    // What the function returned before layouts existed: the same list, with
    // `variant` the only addition, and only on HERO.
    const reconciled = reconcileHomeConfig(legacyStored);

    equal(
        "keys and order are unchanged",
        reconciled.map((section) => section.key),
        legacyStored.map((section) => section.key),
    );
    equal(
        "every enabled flag is unchanged",
        reconciled.map((section) => section.enabled),
        legacyStored.map((section) => section.enabled),
    );
    equal(
        "stripping the layout reproduces the previous output byte for byte",
        reconciled.map(({ key, enabled }) => ({ key, enabled })),
        legacyStored,
    );
    equal(
        "an explicitly disabled section is still disabled",
        reconcileHomeConfig(
            legacyStored.map((section) =>
                section.key === "BLOG" ? { ...section, enabled: false } : section,
            ),
        ).find((section) => section.key === "BLOG")?.enabled,
        false,
    );
}

console.log("\nreconcileHomeConfig — read-only");

{
    const stored = legacyStored.map((section) =>
        section.key === "HERO" ? { ...section, variant: "SLIDER_STACK" } : section,
    );
    const snapshot = JSON.stringify(stored);

    reconcileHomeConfig(stored);
    equal("resolution does not rewrite the stored row", JSON.stringify(stored), snapshot);

    const defaultsSnapshot = JSON.stringify(DEFAULT_HOME_CONFIG);
    reconcileHomeConfig(undefined);
    equal(
        "the non-array path does not write through DEFAULT_HOME_CONFIG",
        JSON.stringify(DEFAULT_HOME_CONFIG),
        defaultsSnapshot,
    );
}

console.log("\nhomeConfigSchema — rejection");

{
    const stored = legacyStored.map((section) =>
        section.key === "HERO" ? { ...section, variant: "NOT_A_LAYOUT" } : section,
    );
    const parsed = homeConfigSchema.safeParse(stored);
    const issue = parsed.error?.issues[0];

    check("an unknown layout on HERO is rejected", !parsed.success);
    equal("the issue points at the offending entry", issue?.path, [0, "variant"]);
    check(
        "and the message names the offered layouts",
        HERO_VARIANTS.every((variant) => issue?.message.includes(variant)),
        issue?.message,
    );
}

{
    const index = HOME_SECTION_KEYS.indexOf("BRAND_BAR");
    const stored = legacyStored.map((section) =>
        section.key === "BRAND_BAR" ? { ...section, variant: "SPLIT_THREE" } : section,
    );
    const parsed = homeConfigSchema.safeParse(stored);

    check("a layout on a section that offers none is rejected", !parsed.success);
    equal("the issue points at that entry", parsed.error?.issues[0]?.path, [index, "variant"]);
}

{
    // The `.strict()` object still has to reject anything else, so adding
    // `variant` did not open the entry up generally.
    const stored = legacyStored.map((section) =>
        section.key === "HERO" ? { ...section, layout: "SPLIT_ONE" } : section,
    );
    check("an unknown field is still rejected", !homeConfigSchema.safeParse(stored).success);
}

{
    check(
        "a list with no variants at all is still valid",
        homeConfigSchema.safeParse(legacyStored).success,
    );
}

console.log(
    failures === 0
        ? "\nAll hero layout checks passed.\n"
        : `\n${failures} check(s) failed.\n`,
);

process.exit(failures === 0 ? 0 : 1);
