/**
 * Verification for homepage section reconciliation.
 *
 * `reconcileHomeConfig` is the one piece of this feature with real logic and
 * real failure modes, and every one of them is silent: a section that stops
 * rendering, a merchant's ordering quietly discarded, a homepage that throws on
 * a value somebody hand-edited. None of those announce themselves.
 *
 * The case that matters most is "a section added in a later release" — if that
 * regresses, every shop that has ever saved a configuration stops receiving new
 * sections, and the only symptom is a feature that appears not to ship.
 *
 * Pure function, no database and no network, so nothing to create and nothing
 * to clean up — which is why this script has no `__verify_*` rows or `finally`
 * block, unlike the mutating verify scripts. Run with:
 *   npx tsx scripts/verify-home-config.ts
 */
import {
    DEFAULT_HOME_CONFIG,
    HOME_SECTION_KEYS,
    HomeSectionConfig,
} from "../src/app/module/store-setting/store-setting.constant";
import { reconcileHomeConfig } from "../src/app/module/store-setting/store-setting.service";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

/** Compact renderer so a failure prints the actual list, not `[object Object]`. */
const show = (sections: HomeSectionConfig[]) =>
    sections.map((s) => `${s.key}${s.enabled ? "" : "(off)"}`).join(" ");

const keysOf = (sections: HomeSectionConfig[]) => sections.map((s) => s.key);

const sameKeys = (sections: HomeSectionConfig[], expected: readonly string[]) =>
    keysOf(sections).length === expected.length &&
    keysOf(sections).every((key, i) => key === expected[i]);

// ── Null and malformed values resolve to the full default ────────────────────
//
// Both roads to this default matter: a store that never configured its homepage
// and a row somebody corrupted. Neither may produce a blank page.

for (const [label, input] of [
    ["null", null],
    ["undefined", undefined],
    ["a string", "HERO,BLOG"],
    ["an object", { HERO: true }],
    ["a number", 7],
] as const) {
    const result = reconcileHomeConfig(input);

    check(
        `malformed: ${label}`,
        sameKeys(result, HOME_SECTION_KEYS) && result.every((s) => s.enabled),
        `resolves to all ${HOME_SECTION_KEYS.length} sections enabled`,
    );
}

check(
    "default config is every section enabled",
    DEFAULT_HOME_CONFIG.length === HOME_SECTION_KEYS.length &&
        DEFAULT_HOME_CONFIG.every((s) => s.enabled),
    `${DEFAULT_HOME_CONFIG.length} sections, all on`,
);

// ── Stored order and enabled flags are preserved ─────────────────────────────

{
    // A complete list in a deliberately non-default order, with two sections off.
    const stored: HomeSectionConfig[] = [
        { key: "BEST_SELLING", enabled: true },
        { key: "HERO", enabled: false },
        { key: "MID_BANNERS", enabled: true },
        { key: "BRAND_BAR", enabled: false },
        { key: "FEATURED_CATEGORIES", enabled: true },
        { key: "FEATURED_PRODUCTS", enabled: true },
        { key: "PERKS_BAR", enabled: true },
        { key: "DEAL_OF_WEEK", enabled: true },
        { key: "NEW_ARRIVALS", enabled: true },
        { key: "TESTIMONIALS", enabled: true },
        { key: "BLOG", enabled: true },
    ];

    const result = reconcileHomeConfig(stored);

    check(
        "complete stored list is returned untouched",
        sameKeys(result, keysOf(stored)) &&
            result.every((s, i) => s.enabled === stored[i].enabled),
        show(result),
    );
}

// ── A section added in a later release ───────────────────────────────────────
//
// THE LOAD-BEARING CASE. Simulated by omitting a key from the stored list, which
// is exactly what a config saved before that section shipped looks like.

{
    // Everything except MID_BANNERS, which sits fifth in the registry.
    const stored = HOME_SECTION_KEYS.filter((key) => key !== "MID_BANNERS").map((key) => ({
        key,
        enabled: true,
    }));

    const result = reconcileHomeConfig(stored);

    check(
        "a missing section is spliced back in",
        result.some((s) => s.key === "MID_BANNERS" && s.enabled),
        "MID_BANNERS present and ENABLED",
    );

    check(
        "…at its registry position, not appended",
        sameKeys(result, HOME_SECTION_KEYS),
        show(result),
    );
}

{
    // The same, but against a merchant's custom order — the splice must respect
    // THEIR ordering, not reset the page to the registry's.
    const stored: HomeSectionConfig[] = [
        { key: "BEST_SELLING", enabled: true },
        { key: "HERO", enabled: false },
        // BRAND_BAR omitted: in the registry it sits directly after HERO.
        { key: "FEATURED_CATEGORIES", enabled: true },
    ];

    const result = reconcileHomeConfig(stored);
    const index = (key: string) => keysOf(result).indexOf(key);

    check(
        "a custom order survives the splice",
        index("BEST_SELLING") === 0 && index("HERO") === 1,
        `merchant's first two kept: ${show(result).split(" ").slice(0, 2).join(" ")}`,
    );

    check(
        "the new section lands after its registry predecessor",
        index("BRAND_BAR") === index("HERO") + 1,
        `BRAND_BAR at ${index("BRAND_BAR")}, directly after HERO at ${index("HERO")}`,
    );

    check(
        "every other missing section is also filled in",
        result.length === HOME_SECTION_KEYS.length,
        `${result.length} sections returned`,
    );

    check(
        "an explicitly disabled section stays disabled",
        result.find((s) => s.key === "HERO")?.enabled === false,
        "HERO still off — absence, not emptiness, is what triggers the splice",
    );
}

{
    // A section added at the TOP of the registry must land at the top of the
    // merchant's page, not the bottom — the `insertAt = 0` path.
    const stored = HOME_SECTION_KEYS.filter((key) => key !== "HERO").map((key) => ({
        key,
        enabled: true,
    }));

    const result = reconcileHomeConfig(stored);

    check(
        "a section first in the registry is spliced to the front",
        keysOf(result)[0] === "HERO",
        `first is ${keysOf(result)[0]}`,
    );
}

// ── A section removed from the registry ──────────────────────────────────────

{
    const stored = [
        { key: "HERO", enabled: true },
        { key: "A_SECTION_THAT_NO_LONGER_EXISTS", enabled: true },
        { key: "BLOG", enabled: false },
    ];

    const result = reconcileHomeConfig(stored);

    check(
        "an unregistered key is dropped",
        !keysOf(result).includes("A_SECTION_THAT_NO_LONGER_EXISTS" as never),
        "unknown key absent from the result",
    );

    check(
        "…without disturbing the rest",
        keysOf(result)[0] === "HERO" &&
            result.find((s) => s.key === "BLOG")?.enabled === false,
        `HERO still first, BLOG still off — ${show(result)}`,
    );

    check(
        "…and the registry is still filled out",
        result.length === HOME_SECTION_KEYS.length,
        `${result.length} sections returned`,
    );
}

// ── Duplicate keys collapse to the first occurrence ──────────────────────────

{
    const stored = [
        { key: "BLOG", enabled: true },
        { key: "HERO", enabled: true },
        { key: "BLOG", enabled: false },
    ];

    const result = reconcileHomeConfig(stored);

    check(
        "a duplicate key renders once",
        keysOf(result).filter((key) => key === "BLOG").length === 1,
        "BLOG appears exactly once",
    );

    check(
        "…at its first position, with its first value",
        keysOf(result)[0] === "BLOG" && result[0].enabled === true,
        "first occurrence won — the later enabled:false was ignored",
    );
}

// ── All-off is a real configuration, not an unconfigured one ─────────────────
//
// The distinction reconciliation has to keep: "every section explicitly off" is
// a merchant's choice and must survive; "no sections listed at all" is a value
// that says nothing and resolves to the default.

{
    const allOff = HOME_SECTION_KEYS.map((key) => ({ key, enabled: false }));
    const result = reconcileHomeConfig(allOff);

    check(
        "an all-disabled list is returned as given",
        result.length === HOME_SECTION_KEYS.length && result.every((s) => !s.enabled),
        "every section still off — not healed back to the default",
    );
}

{
    const result = reconcileHomeConfig([]);

    check(
        "an empty list fills out to the default",
        result.length === HOME_SECTION_KEYS.length && result.every((s) => s.enabled),
        "no sections named means nothing was said, so everything is on",
    );
}

// ── Entries that are not objects ─────────────────────────────────────────────

{
    const result = reconcileHomeConfig([
        { key: "HERO", enabled: true },
        null,
        "BLOG",
        42,
        { enabled: true },
        { key: "BLOG", enabled: false },
    ]);

    check(
        "junk entries are skipped, valid ones kept",
        keysOf(result)[0] === "HERO" &&
            result.find((s) => s.key === "BLOG")?.enabled === false &&
            result.length === HOME_SECTION_KEYS.length,
        show(result),
    );
}

console.log(
    failures === 0
        ? "\nAll home config reconciliation checks passed."
        : `\n${failures} check(s) FAILED.`,
);

process.exit(failures === 0 ? 0 : 1);
