/**
 * Which database serves a request, and that no two demos can see each other.
 *
 * ── What is actually at risk here ─────────────────────────────────────────
 *
 * `lib/prisma.ts` no longer exports a client; it exports a Proxy that resolves,
 * on every property access, to whichever client the current `AsyncLocalStorage`
 * scope holds. That is what lets one deployment serve several demonstration
 * shops without editing the 55 files that import it — and it is also the kind
 * of mechanism that fails silently. A scope that does not survive an `await`
 * writes one demo's order into another's database and reports success.
 *
 * So the assertions below are not "the map parses". They are: a write under one
 * key is invisible under another, a transaction stays whole on one database,
 * interleaved concurrent work does not bleed, and — the one that protects every
 * client installation — an unkeyed or unknown-keyed request is served by
 * DATABASE_URL exactly as it was before any of this existed.
 *
 * ── Running it ────────────────────────────────────────────────────────────
 *
 * Needs two throwaway databases with the schema applied, named in
 * DEMO_DATABASES, and a DATABASE_URL pointing at a third:
 *
 *   DEMO_DATABASES='{"fashion":"mysql://root:pw@localhost:3306/demo_fashion","grocery":"mysql://root:pw@localhost:3306/demo_grocery"}' \
 *   npx tsx scripts/verify-demo-isolation.ts
 *
 * Every row it creates is `__vdemo_`-prefixed and removed in the finally, from
 * all three databases.
 */
import { ProductStatus } from "../src/generated/prisma/client";
import { prisma } from "../src/app/lib/prisma";
import {
    DEFAULT_DEMO_KEY,
    demoKeys,
    hasDemoMap,
    disposeClients,
    resolveDemoKey,
    runInDemoScope,
} from "../src/app/lib/tenant";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

const MARKER = "__vdemo_";

/** Runs `fn` with `key` in scope, the way the request middleware would. */
const asDemo = <T>(key: string, fn: () => Promise<T>): Promise<T> => runInDemoScope(key, fn);

/** A category to hang probe products from — each database needs its own. */
const ensureCategory = async (): Promise<string> => {
    const existing = await prisma.category.findFirst({ where: { slug: `${MARKER}cat` } });
    if (existing) return existing.id;
    const made = await prisma.category.create({
        data: { name: `${MARKER}Category`, slug: `${MARKER}cat` },
    });
    return made.id;
};

const createProduct = async (name: string) => {
    const categoryId = await ensureCategory();
    return prisma.product.create({
        data: {
            name: `${MARKER}${name}`,
            slug: `${MARKER}${name.toLowerCase()}`,
            categoryId,
            status: ProductStatus.ACTIVE,
            offerPrice: 100,
        },
    });
};

const productNames = async (): Promise<string[]> =>
    (await prisma.product.findMany({ where: { name: { startsWith: MARKER } } })).map((p) => p.name);

const cleanup = async () => {
    await prisma.orderItem.deleteMany({ where: { productName: { startsWith: MARKER } } });
    await prisma.product.deleteMany({ where: { name: { startsWith: MARKER } } });
    await prisma.category.deleteMany({ where: { slug: { startsWith: MARKER } } });
};

const main = async () => {
    // Skipped, not failed, when no demo map is configured: that is the state of
    // every client installation and of the suite run that guards them, and a
    // script that cannot apply should not look like a broken one.
    if (!hasDemoMap) {
        console.log("SKIP  DEMO_DATABASES is not set — nothing to isolate. See the header of this file.");
        return;
    }

    const keys = demoKeys();
    if (keys.length < 2) {
        console.error(`Needs at least two demos in DEMO_DATABASES; found ${keys.length}.`);
        process.exitCode = 1;
        return;
    }

    const [a, b] = keys;
    console.log(`\ndemos: ${keys.join(", ")}  |  testing "${a}" against "${b}"\n`);

    try {
        /* ---- key resolution, before any database work ---- */
        check(
            "a configured key resolves to itself",
            resolveDemoKey(a) === a,
            `"${a}" -> "${resolveDemoKey(a)}"`,
        );
        check(
            "an unknown key falls back rather than failing",
            resolveDemoKey("no-such-demo") === DEFAULT_DEMO_KEY,
            `"no-such-demo" -> "${resolveDemoKey("no-such-demo")}"`,
        );
        check(
            "an absent header falls back",
            resolveDemoKey(undefined) === DEFAULT_DEMO_KEY,
            `undefined -> "${resolveDemoKey(undefined)}"`,
        );
        check(
            "a key is matched regardless of case",
            resolveDemoKey(a.toUpperCase()) === a,
            `"${a.toUpperCase()}" -> "${resolveDemoKey(a.toUpperCase())}"`,
        );

        /* ---- Scenario: two demos hold separate catalogues ---- */
        await asDemo(a, () => createProduct("OnlyInA"));

        const inA = await asDemo(a, productNames);
        const inB = await asDemo(b, productNames);

        check(
            "a product written under one key is present under that key",
            inA.includes(`${MARKER}OnlyInA`),
            `${a} sees ${inA.length} probe product(s)`,
        );
        check(
            "and absent under the other",
            !inB.includes(`${MARKER}OnlyInA`),
            `${b} sees ${inB.length} probe product(s)`,
        );

        /* ---- Scenario: background work outside a request ---- */
        // No scope entered at all — this is what seeds, cron jobs and the other
        // verify scripts get, and it must be the DATABASE_URL shop.
        const unscoped = await productNames();
        check(
            "work outside any request is served by DATABASE_URL",
            !unscoped.includes(`${MARKER}OnlyInA`),
            `the default shop sees ${unscoped.length} probe product(s), not A's`,
        );

        /* ---- Scenario: an unknown key is served the default shop ---- */
        const unknown = await asDemo(resolveDemoKey("no-such-demo"), productNames);
        check(
            "an unknown key reads the default shop, not a demo",
            !unknown.includes(`${MARKER}OnlyInA`),
            `${unknown.length} probe product(s)`,
        );

        /* ---- Scenario: concurrent requests do not bleed ---- */
        /*
         * The assertion the whole design rests on. Each task awaits inside its
         * own scope while the other is mid-flight; if AsyncLocalStorage did not
         * follow the await, one of these would read the other's database.
         * Interleaved deliberately — a write, a read, a write, a read.
         */
        const [seenByA, seenByB] = await Promise.all([
            asDemo(a, async () => {
                await createProduct("ConcurrentA");
                await new Promise((r) => setTimeout(r, 25));
                return productNames();
            }),
            asDemo(b, async () => {
                await new Promise((r) => setTimeout(r, 10));
                await createProduct("ConcurrentB");
                await new Promise((r) => setTimeout(r, 25));
                return productNames();
            }),
        ]);

        check(
            "concurrent work: A sees its own write and not B's",
            seenByA.includes(`${MARKER}ConcurrentA`) && !seenByA.includes(`${MARKER}ConcurrentB`),
            `${a} saw [${seenByA.join(", ")}]`,
        );
        check(
            "concurrent work: B sees its own write and not A's",
            seenByB.includes(`${MARKER}ConcurrentB`) && !seenByB.includes(`${MARKER}ConcurrentA`),
            `${b} saw [${seenByB.join(", ")}]`,
        );

        /* ---- Scenario: a transaction stays on one database ---- */
        /*
         * A transaction resumes across awaits on a dedicated connection. If the
         * scope were lost partway, the later statements would land elsewhere —
         * so this writes twice inside one transaction and then counts both rows
         * in A and neither in B.
         */
        await asDemo(a, () =>
            prisma.$transaction(async (tx) => {
                const categoryId = (await tx.category.findFirstOrThrow({
                    where: { slug: `${MARKER}cat` },
                })).id;
                await tx.product.create({
                    data: {
                        name: `${MARKER}TxOne`,
                        slug: `${MARKER}txone`,
                        categoryId,
                        status: ProductStatus.ACTIVE,
                        offerPrice: 100,
                    },
                });
                await new Promise((r) => setTimeout(r, 20));
                await tx.product.create({
                    data: {
                        name: `${MARKER}TxTwo`,
                        slug: `${MARKER}txtwo`,
                        categoryId,
                        status: ProductStatus.ACTIVE,
                        offerPrice: 100,
                    },
                });
            }),
        );

        const txInA = await asDemo(a, productNames);
        const txInB = await asDemo(b, productNames);

        check(
            "a transaction's every statement lands on one database",
            txInA.includes(`${MARKER}TxOne`) && txInA.includes(`${MARKER}TxTwo`),
            `${a} has TxOne=${txInA.includes(`${MARKER}TxOne`)}, TxTwo=${txInA.includes(`${MARKER}TxTwo`)}`,
        );
        check(
            "and none of it reaches another",
            !txInB.includes(`${MARKER}TxOne`) && !txInB.includes(`${MARKER}TxTwo`),
            `${b} has neither`,
        );

        /* ---- Raw SQL resolves through the same scope ---- */
        // $queryRaw goes through the Proxy like everything else; asserted because
        // a bound-method mistake in the Proxy would show up here first.
        const rawA = await asDemo(a, async () => {
            const rows = await prisma.$queryRaw<{ n: number | bigint }[]>`
                SELECT COUNT(*) AS n FROM Product WHERE name LIKE ${`${MARKER}%`}
            `;
            return Number(rows[0].n);
        });
        const rawB = await asDemo(b, async () => {
            const rows = await prisma.$queryRaw<{ n: number | bigint }[]>`
                SELECT COUNT(*) AS n FROM Product WHERE name LIKE ${`${MARKER}%`}
            `;
            return Number(rows[0].n);
        });
        check(
            "raw SQL resolves through the same scope",
            rawA > rawB,
            `${a} counted ${rawA}, ${b} counted ${rawB}`,
        );
    } finally {
        for (const key of [DEFAULT_DEMO_KEY, ...demoKeys()]) {
            await asDemo(key, cleanup).catch(() => undefined);
        }

        // Without this the demo pools keep the event loop alive and the script
        // hangs after printing its results — which the suite reads as a failure.
        await disposeClients();
    }

    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
    if (failures > 0) process.exitCode = 1;
};

main();
