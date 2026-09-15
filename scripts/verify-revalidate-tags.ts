/**
 * Checks that the backend and the storefront agree on every cache tag name.
 *
 * The two live in separate pnpm workspaces that never import each other, so a
 * tag is a bare string duplicated across a package boundary: the backend fires
 * `"campaigns"` and the storefront allow-lists `"campaigns"`, and nothing
 * enforces the match.
 *
 * A mismatch is SILENT, which is why this exists. The storefront answers 400
 * "Unknown tag"; `revalidateStorefront` only `console.warn`s a non-OK response,
 * because a failed invalidation must never fail the merchant's save. So a typo
 * produces: a successful save, no error in the admin, no error on the
 * storefront, and a resource that quietly reverts to expiring on its own
 * five-minute window — indistinguishable from the bug this whole change fixed.
 *
 * Three drifts are caught:
 *   1. Fired but not allow-listed  → every invalidation 400s, silently
 *   2. Allow-listed but never fired → a tag nothing can ever drop
 *   3. Declared but never carried   → a read with no `tags`, so nothing to drop
 *
 * Reads all three files as TEXT rather than importing them. The storefront's
 * `route.ts` imports `next/cache` and a dozen service modules; importing it from
 * a tsx script under `server/` would pull Next's runtime into a plain Node
 * process for no benefit. Parsing for literals is the cheaper boundary, and it
 * is what a reader can follow.
 *
 * Touches no database and needs no running server, unlike most verify scripts
 * here — it is a static consistency check.
 *
 * Run with: npx tsx scripts/verify-revalidate-tags.ts
 *
 * See openspec/changes/add-storefront-cache-tags — design.md Decision 3.
 */
import fs from "node:fs";
import path from "node:path";

const SERVER_ROOT = process.cwd();
const BACKEND_TAGS_FILE = path.join(SERVER_ROOT, "src", "app", "utils", "revalidateStorefront.ts");
const STOREFRONT_ROOT = path.join(SERVER_ROOT, "..", "nextjs");
const REVALIDATE_ROUTE = path.join(STOREFRONT_ROOT, "src", "app", "api", "revalidate", "route.ts");
const SERVICES_DIR = path.join(STOREFRONT_ROOT, "src", "services");
const MODULE_DIR = path.join(SERVER_ROOT, "src", "app", "module");

let failures = 0;

const fail = (message: string) => {
    failures += 1;
    console.error(`  FAIL  ${message}`);
};

const pass = (message: string) => console.log(`  ok    ${message}`);

const read = (file: string, label: string): string | null => {
    if (!fs.existsSync(file)) {
        fail(`${label} not found at ${file}`);
        return null;
    }
    return fs.readFileSync(file, "utf8");
};

/** Every `.ts` file one level deep under `src/app/module`. */
const listModuleFiles = (): string[] => {
    if (!fs.existsSync(MODULE_DIR)) return [];

    return fs.readdirSync(MODULE_DIR).flatMap((entry) => {
        const moduleDir = path.join(MODULE_DIR, entry);
        if (!fs.statSync(moduleDir).isDirectory()) return [];

        return fs
            .readdirSync(moduleDir)
            .filter((file) => file.endsWith(".ts"))
            .map((file) => path.join(moduleDir, file));
    });
};

/** `export const CAMPAIGNS_TAG = "campaigns";` → `CAMPAIGNS_TAG` -> `campaigns`. */
const readExportedTags = (source: string, suffix: string): Map<string, string> => {
    const found = new Map<string, string>();
    const pattern = new RegExp(`export const (\\w*${suffix})\\s*=\\s*"([^"]+)"`, "g");

    for (const match of source.matchAll(pattern)) {
        found.set(match[1], match[2]);
    }

    return found;
};

console.log("\nBackend tag constants vs storefront allow-list\n");

const backendSource = read(BACKEND_TAGS_FILE, "revalidateStorefront.ts");
const routeSource = read(REVALIDATE_ROUTE, "storefront revalidate route");

if (!backendSource || !routeSource) {
    console.log(`\n${failures} check(s) FAILED.\n`);
    process.exit(1);
}

/*
 * Two homes, both legitimate. `revalidateStorefront.ts` holds the tags shared
 * across modules (`products` is fired by product, campaign, review and stock);
 * a tag used by exactly one module instead lives in that module's own
 * `.constant.ts`, which is where the repo's "only values shared beyond the
 * module" rule puts it. Blog, testimonial and landing-page predate this change
 * and take the second form.
 *
 * Both are collected, or this reports a correctly-wired tag as missing.
 */
const backendTags = readExportedTags(backendSource, "_TAG");

for (const file of listModuleFiles()) {
    if (!file.endsWith(".constant.ts")) continue;

    for (const [name, value] of readExportedTags(fs.readFileSync(file, "utf8"), "_TAG")) {
        backendTags.set(name, value);
    }
}

if (backendTags.size === 0) {
    fail("No exported *_TAG constants found in revalidateStorefront.ts or any module constant");
}

/*
 * The allow-list holds imported IDENTIFIERS, not string literals, so the values
 * are resolved from the services the route imports them from. That indirection
 * is the point: it means this script verifies the same constant the running code
 * uses, rather than a literal that could have drifted from it.
 */
const allowListBlock = routeSource.match(/const ALLOWED_TAGS = new Set<string>\(\[([\s\S]*?)\]\)/);

if (!allowListBlock) {
    fail("Could not locate ALLOWED_TAGS in the storefront revalidate route");
    console.log(`\n${failures} check(s) FAILED.\n`);
    process.exit(1);
}

const allowListIdentifiers = [...allowListBlock[1].matchAll(/^\s*(\w+_CACHE_TAG),/gm)].map(
    (match) => match[1],
);

/** `import { X_CACHE_TAG } from "@/services/foo";` → identifier -> "foo". */
const importSources = new Map<string, string>();
for (const match of routeSource.matchAll(
    /import\s*\{\s*(\w+_CACHE_TAG)\s*\}\s*from\s*"@\/services\/([\w-]+)"/g,
)) {
    importSources.set(match[1], match[2]);
}

const storefrontTags = new Map<string, string>();

for (const identifier of allowListIdentifiers) {
    const serviceName = importSources.get(identifier);

    if (!serviceName) {
        fail(`${identifier} is in ALLOWED_TAGS but is not imported from @/services/*`);
        continue;
    }

    const serviceSource = read(path.join(SERVICES_DIR, `${serviceName}.ts`), `service ${serviceName}.ts`);
    if (!serviceSource) continue;

    const declared = readExportedTags(serviceSource, "_CACHE_TAG").get(identifier);

    if (!declared) {
        fail(`${identifier} is imported from @/services/${serviceName} but not exported there`);
        continue;
    }

    storefrontTags.set(identifier, declared);

    /*
     * Drift 3. A tag can be declared, exported and allow-listed and STILL do
     * nothing, because `apiFetch` ignores `tags` unless `revalidate` is also
     * present — so an unused constant looks exactly like a working one.
     */
    if (!new RegExp(`tags:\\s*\\[[^\\]]*\\b${identifier}\\b`).test(serviceSource)) {
        fail(`${identifier} is declared in ${serviceName}.ts but never passed to apiFetch as a tag`);
    }
}

const backendValues = new Set(backendTags.values());
const storefrontValues = new Set(storefrontTags.values());

console.log("Tag values");

// Drift 1: the backend fires something the storefront will reject with a 400.
for (const [name, value] of backendTags) {
    if (storefrontValues.has(value)) {
        pass(`${name} = "${value}" is allow-listed`);
    } else {
        fail(`${name} = "${value}" is fired by the backend but NOT in ALLOWED_TAGS`);
    }
}

// Drift 2: an allow-listed tag no code path can ever drop.
for (const [name, value] of storefrontTags) {
    if (!backendValues.has(value)) {
        fail(`${name} = "${value}" is allow-listed but no backend constant fires it`);
    }
}

/*
 * A constant can exist, match, and still never be called — which is the failure
 * that shipped seven untagged resources in the first place. Checks the whole
 * module tree rather than a fixed list, so a tag added later is covered without
 * editing this script.
 */
console.log("\nEvery backend tag is actually fired somewhere");

const moduleSources = listModuleFiles()
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");

for (const [name] of backendTags) {
    /*
     * The declaration itself does not count as a use. A tag defined in a
     * module's own `.constant.ts` would otherwise match its own export line and
     * pass while nothing ever fired it.
     */
    const fired = new RegExp(`revalidateStorefront\\(\\s*${name}\\b`).test(moduleSources);

    if (fired) {
        pass(`${name} is referenced by at least one module`);
    } else {
        fail(`${name} is exported but never used — no write invalidates it`);
    }
}

console.log(
    `\n${backendTags.size} backend tag(s), ${storefrontTags.size} allow-listed tag(s).`,
);
console.log(`${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);
