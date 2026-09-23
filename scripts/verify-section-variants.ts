/**
 * Checks the rules a home page section's LAYOUT obeys on the way in and on the
 * way out — for EVERY section that offers one.
 *
 * Why this script exists rather than a comment: the failure this guards is
 * silent. `reconcileHomeConfig` REBUILDS each section entry rather than passing
 * it through, so a `variant` that is not carried explicitly through the map and
 * both rebuild paths is dropped on the way out — the merchant's choice saves,
 * persists correctly in the column, and is gone on the very next read. Nothing
 * throws, nothing logs, and every manual test that does not reload the page
 * passes. See openspec/changes/add-hero-section-variants, design.md Decision 4.
 *
 * Why it iterates the registry rather than naming HERO: it used to be
 * `verify-hero-section-variants.ts`, with `HERO_VARIANTS` written into it in
 * three places. The second section to offer layouts would have needed the whole
 * file copied, and the third would have found the copy already out of step. So
 * every check below runs once per key of `HOME_SECTION_VARIANTS`, and a section
 * added to that map is covered without this file being touched. See
 * openspec/changes/add-featured-categories-layout, design.md Decision 1.
 *
 * STATIC AND DB-FREE, like verify-postman-routes.ts: it imports the validation
 * schema and the reconciler and calls them directly, so it runs in CI, on a
 * laptop with no database, and before any migration.
 *
 * Run with: npx tsx scripts/verify-section-variants.ts
 */
import {
    DEFAULT_HOME_CONFIG,
    HOME_SECTION_KEYS,
    HOME_SECTION_VARIANTS,
    resolveSectionVariant,
    type HomeSectionConfig,
    type HomeSectionKey,
} from "../src/app/module/store-setting/store-setting.constant";
import { homeConfigSchema } from "../src/app/module/store-setting/store-setting.validation";
import { reconcileHomeConfig } from "../src/app/module/store-setting/store-setting.service";

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

/** Every section that offers a choice, with its offered layouts, in registry order. */
const OFFERING = (Object.entries(HOME_SECTION_VARIANTS) as [HomeSectionKey, readonly string[]][]).sort(
    ([a], [b]) => HOME_SECTION_KEYS.indexOf(a) - HOME_SECTION_KEYS.indexOf(b),
);

const offers = new Set<string>(OFFERING.map(([key]) => key));

/** A section that offers no choice at all, for the negative cases. */
const PLAIN_KEY = HOME_SECTION_KEYS.find((key) => !offers.has(key));
if (!PLAIN_KEY) throw new Error("every section offers layouts — the negative cases need one that does not");

/** One section's entry in a reconciled list. */
const entry = (config: HomeSectionConfig[], key: HomeSectionKey) =>
    config.find((section) => section.key === key);

/** A stored list in the shape a row written before layouts existed carries. */
const legacyStored = HOME_SECTION_KEYS.map((key) => ({ key, enabled: true }));

/** `legacyStored` with one section's entry replaced. */
const withEntry = (key: HomeSectionKey, patch: Record<string, unknown>) =>
    legacyStored.map((section) => (section.key === key ? { ...section, ...patch } : section));

check(
    "at least one section offers layouts",
    OFFERING.length > 0,
    "HOME_SECTION_VARIANTS is empty — nothing to verify",
);

for (const [key, offered] of OFFERING) {
    const DEFAULT_VARIANT = offered[0];

    console.log(`\n${key} — resolveSectionVariant`);

    equal("absent resolves to the default", resolveSectionVariant(key, undefined), DEFAULT_VARIANT);
    equal(
        "unrecognised string resolves to the default",
        resolveSectionVariant(key, "NOT_A_LAYOUT"),
        DEFAULT_VARIANT,
    );
    equal("null resolves to the default", resolveSectionVariant(key, null), DEFAULT_VARIANT);
    equal("a non-string resolves to the default", resolveSectionVariant(key, 7), DEFAULT_VARIANT);

    for (const variant of offered) {
        equal(`${variant} resolves to itself`, resolveSectionVariant(key, variant), variant);
    }

    console.log(`\n${key} — reconcileHomeConfig, resolution`);

    equal(
        "a row that predates layouts reads as the default",
        entry(reconcileHomeConfig(legacyStored), key)?.variant,
        DEFAULT_VARIANT,
    );
    equal(
        "a non-array stored value still resolves the layout",
        entry(reconcileHomeConfig(null), key)?.variant,
        DEFAULT_VARIANT,
    );
    equal(
        "a withdrawn layout falls back to the default",
        entry(reconcileHomeConfig(withEntry(key, { variant: "NOT_A_LAYOUT" })), key)?.variant,
        DEFAULT_VARIANT,
    );

    {
        // The section absent entirely — the splice path, which is the second
        // rebuild and the one most easily forgotten.
        const reconciled = reconcileHomeConfig(legacyStored.filter((section) => section.key !== key));

        equal("a spliced-in section carries the default layout", entry(reconciled, key)?.variant, DEFAULT_VARIANT);
        equal(
            "and is spliced where the registry orders it",
            reconciled.findIndex((section) => section.key === key),
            HOME_SECTION_KEYS.indexOf(key),
        );
    }

    console.log(`\n${key} — the round trip (the silent-drop guard)`);

    for (const variant of offered) {
        const stored = withEntry(key, { variant });
        const parsed = homeConfigSchema.safeParse(stored);

        check(`${variant} passes validation`, parsed.success, JSON.stringify(parsed.error?.issues));
        equal(
            `${variant} survives reconciliation`,
            entry(reconcileHomeConfig(parsed.success ? parsed.data : stored), key)?.variant,
            variant,
        );
    }

    console.log(`\n${key} — read-only`);

    {
        const stored = withEntry(key, { variant: offered[offered.length - 1] });
        const snapshot = JSON.stringify(stored);

        reconcileHomeConfig(stored);
        equal("resolution does not rewrite the stored row", JSON.stringify(stored), snapshot);
    }

    console.log(`\n${key} — homeConfigSchema rejection`);

    {
        const index = HOME_SECTION_KEYS.indexOf(key);
        const parsed = homeConfigSchema.safeParse(withEntry(key, { variant: "NOT_A_LAYOUT" }));
        const issue = parsed.error?.issues[0];

        check("an unknown layout is rejected", !parsed.success);
        equal("the issue points at the offending entry", issue?.path, [index, "variant"]);
        check(
            "and the message names every offered layout",
            offered.every((variant) => issue?.message.includes(variant)),
            issue?.message,
        );
    }
}

console.log("\nsections that offer no layout");

equal(
    `${PLAIN_KEY} resolves to undefined`,
    resolveSectionVariant(PLAIN_KEY, undefined),
    undefined,
);
equal(
    `a layout on ${PLAIN_KEY} is still undefined`,
    resolveSectionVariant(PLAIN_KEY, OFFERING[0][1][0]),
    undefined,
);
check(
    "every section that offers no layout carries no variant KEY at all",
    reconcileHomeConfig(legacyStored)
        .filter((section) => !offers.has(section.key))
        .every((section) => !("variant" in section)),
    "a section that offers no layout must omit the key, not set it to undefined",
);

{
    const index = HOME_SECTION_KEYS.indexOf(PLAIN_KEY);
    const parsed = homeConfigSchema.safeParse(withEntry(PLAIN_KEY, { variant: OFFERING[0][1][0] }));

    check(`a layout on ${PLAIN_KEY} is rejected`, !parsed.success);
    equal("the issue points at that entry", parsed.error?.issues[0]?.path, [index, "variant"]);
}

console.log("\nan untouched store is unaffected");

{
    // What the function returned before layouts existed: the same list, with
    // `variant` the only addition, and only on the sections that offer one.
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
        "stripping the layouts reproduces the previous output byte for byte",
        reconciled.map(({ key, enabled }) => ({ key, enabled })),
        legacyStored,
    );
    equal(
        "an explicitly disabled section is still disabled",
        reconcileHomeConfig(withEntry("BLOG", { enabled: false })).find((section) => section.key === "BLOG")
            ?.enabled,
        false,
    );

    const defaultsSnapshot = JSON.stringify(DEFAULT_HOME_CONFIG);
    reconcileHomeConfig(undefined);
    equal(
        "the non-array path does not write through DEFAULT_HOME_CONFIG",
        JSON.stringify(DEFAULT_HOME_CONFIG),
        defaultsSnapshot,
    );
}

console.log("\nhomeConfigSchema — shape");

{
    // The `.strict()` object still has to reject anything else, so adding
    // `variant` did not open the entry up generally.
    const [key] = OFFERING[0];
    check(
        "an unknown field is still rejected",
        !homeConfigSchema.safeParse(withEntry(key, { layout: "ANYTHING" })).success,
    );
    check("a list with no variants at all is still valid", homeConfigSchema.safeParse(legacyStored).success);
}

console.log(
    failures === 0
        ? `\nAll layout checks passed for ${OFFERING.map(([key]) => key).join(", ")}.\n`
        : `\n${failures} check(s) failed.\n`,
);

process.exit(failures === 0 ? 0 : 1);
