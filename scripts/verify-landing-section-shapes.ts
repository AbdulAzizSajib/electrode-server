/**
 * Pins the three hand-synced copies of a landing page's section vocabulary.
 *
 * The section keys, the default order, which keys may repeat, which may not be
 * switched off, and the custom-section bounds all exist THREE times: here in
 * `landing-page.constant.ts`, in `frontend/src/lib/landing-sections.ts`, and in
 * `admin/src/lib/api/landing-pages.ts`. The packages never import each other,
 * so a key renamed in one place produces NO type error anywhere — and every
 * failure that follows is silent:
 *
 *   - Admin out of step: the merchant arranges a section the backend refuses, or
 *     is offered one the storefront cannot draw. Their save vanishes behind a
 *     success toast, or the section never appears.
 *   - Storefront out of step: a stored key stops resolving and the section
 *     quietly disappears from a live campaign. Nothing errors; the merchant just
 *     finds a block missing at some point after the fact.
 *
 * THE DEFAULT ORDER IS THE MOST IMPORTANT LINE HERE. Every campaign that
 * predates the section editor stores NULL and renders that order, so a drift
 * between the backend's copy and the storefront's silently restyles every one of
 * them — the one failure this whole change was built to avoid.
 *
 * Checked by reading the two frontend files as TEXT. They cannot be imported
 * from here — different tsconfig, different module resolution — and a shallow
 * check that catches a rename is worth more than a perfect one that never runs.
 * Same arrangement, and same reasoning, as `verify-landing-page-shapes.ts`.
 *
 * Reads only; creates nothing and needs no cleanup.
 *
 * Run with:
 *   npx tsx scripts/verify-landing-section-shapes.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    DEFAULT_LANDING_SECTION_ORDER,
    LANDING_CUSTOM_SECTION_LAYOUTS,
    LANDING_REPEATABLE_SECTION_KEYS,
    LANDING_REQUIRED_SECTION_KEYS,
    LANDING_SECTION_KEYS,
    MAX_CUSTOM_SECTIONS,
} from "../src/app/module/landing-page/landing-page.constant";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

/** Repo root, from server/scripts. */
const ROOT = join(import.meta.dirname, "..", "..");

const readOrNull = (relativePath: string): string | null => {
    try {
        return readFileSync(join(ROOT, relativePath), "utf8");
    } catch {
        return null;
    }
};

/**
 * The string literals of a `const NAME = [...]` array, in source order.
 *
 * Order matters for every list checked here — the default order most of all —
 * so this deliberately does NOT sort.
 */
const arrayLiterals = (source: string, name: string): string[] | null => {
    const declaration = source.indexOf(`const ${name}`);
    if (declaration === -1) return null;

    /*
     * Start at the `=`, not at the declaration.
     *
     * Several of these carry a `readonly LandingSectionKey[]` annotation, and
     * scanning for the first `[` from the name would find the one in that TYPE
     * rather than the array literal — returning an empty list, which then
     * compares unequal to everything and reports drift that does not exist.
     * A false alarm here is worse than useless: it trains whoever sees it to
     * distrust the script.
     */
    const assignment = source.indexOf("=", declaration);
    if (assignment === -1) return null;

    const open = source.indexOf("[", assignment);
    const close = source.indexOf("]", open);
    if (open === -1 || close === -1) return null;

    return (source.slice(open, close).match(/["'][A-Z_]+["']/g) ?? []).map((literal) =>
        literal.replace(/["']/g, ""),
    );
};

const numberLiteral = (source: string, name: string): number | null => {
    const match = source.match(new RegExp(`${name}\\s*=\\s*(\\d+)`));
    return match ? Number(match[1]) : null;
};

const STOREFRONT = "frontend/src/lib/landing-sections.ts";
const ADMIN = "admin/src/lib/api/landing-pages.ts";

const main = () => {
    const storefront = readOrNull(STOREFRONT);
    const admin = readOrNull(ADMIN);

    check(`${STOREFRONT} is readable`, storefront !== null, storefront ? "found" : "MISSING");
    check(`${ADMIN} is readable`, admin !== null, admin ? "found" : "MISSING");

    if (!storefront || !admin) {
        console.log("\nCannot compare without both files.");
        return;
    }

    const backendKeys = [...LANDING_SECTION_KEYS];
    const backendDefault = [...DEFAULT_LANDING_SECTION_ORDER];

    /*
     * THE ONE THAT MATTERS MOST. A page with no stored order renders this, and
     * every campaign that predates the editor is in that state.
     */
    const storefrontDefault = arrayLiterals(storefront, "DEFAULT_LANDING_SECTION_ORDER");
    check(
        "the default section order matches the storefront's",
        JSON.stringify(backendDefault) === JSON.stringify(storefrontDefault),
        `backend ${backendDefault.join(" → ")} | storefront ${storefrontDefault?.join(" → ") ?? "NOT FOUND"}`,
    );

    const adminDefault = arrayLiterals(admin, "DEFAULT_LANDING_SECTION_ORDER");
    check(
        "the default section order matches the admin's",
        JSON.stringify(backendDefault) === JSON.stringify(adminDefault),
        `admin ${adminDefault?.join(" → ") ?? "NOT FOUND"}`,
    );

    const adminKeys = arrayLiterals(admin, "LANDING_SECTION_KEYS");
    check(
        "the section keys match the admin's",
        JSON.stringify(backendKeys) === JSON.stringify(adminKeys),
        `backend ${backendKeys.length} keys | admin ${adminKeys?.length ?? 0}`,
    );

    /*
     * The storefront declares its known keys as a Set rather than a tuple, so
     * membership is what is checked rather than order: a key the storefront
     * cannot resolve is a section that silently vanishes from a live page.
     */
    backendKeys.forEach((key) => {
        check(
            `the storefront can resolve "${key}"`,
            new RegExp(`["']${key}["']`).test(storefront),
            "a key the storefront does not know is a section that disappears without erroring",
        );
    });

    const adminRepeatable = arrayLiterals(admin, "LANDING_REPEATABLE_SECTION_KEYS");
    check(
        "the repeatable keys match the admin's",
        JSON.stringify([...LANDING_REPEATABLE_SECTION_KEYS]) === JSON.stringify(adminRepeatable),
        `matching on key alone would collapse every one of these — backend ${[...LANDING_REPEATABLE_SECTION_KEYS].join(", ")}`,
    );

    const adminRequired = arrayLiterals(admin, "LANDING_REQUIRED_SECTION_KEYS");
    check(
        "the non-removable keys match the admin's",
        JSON.stringify([...LANDING_REQUIRED_SECTION_KEYS]) === JSON.stringify(adminRequired),
        `the admin must not offer a switch the backend refuses — backend ${[...LANDING_REQUIRED_SECTION_KEYS].join(", ")}`,
    );

    const adminLayouts = arrayLiterals(admin, "LANDING_CUSTOM_SECTION_LAYOUTS");
    check(
        "the custom section layouts match the admin's",
        JSON.stringify([...LANDING_CUSTOM_SECTION_LAYOUTS]) === JSON.stringify(adminLayouts),
        `backend ${[...LANDING_CUSTOM_SECTION_LAYOUTS].join(", ")} | admin ${adminLayouts?.join(", ") ?? "NOT FOUND"}`,
    );

    const adminMax = numberLiteral(admin, "MAX_CUSTOM_SECTIONS");
    check(
        "the custom section limit matches the admin's",
        adminMax === MAX_CUSTOM_SECTIONS,
        `backend ${MAX_CUSTOM_SECTIONS} | admin ${adminMax ?? "NOT FOUND"} — a higher admin limit lets a merchant build a page the API then refuses`,
    );
};

main();

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
