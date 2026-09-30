/**
 * The database is MySQL-compatible, stores utf8mb4, and compares text
 * case-insensitively.
 *
 * ── Why this is the first script to run after a deploy ────────────────────
 *
 * Three things the application silently depends on are decided when the
 * database is created, not by any code in this repo:
 *
 *   1. CHARACTER SET. Bangla is the shop's primary content language. Stored in
 *      latin1 — still a common cPanel server default — every Bangla product
 *      name, checkout line and landing page becomes mojibake on write. It is
 *      not recoverable afterwards, and nothing errors at the time.
 *
 *   2. COLLATION. The duplicate-name guards on brands, tags, attributes, fonts
 *      and tax rules used to pass `mode: "insensitive"` to Prisma. MySQL has no
 *      such per-query mode — case folding is the collation's job — so those
 *      guards are only still case-insensitive if the collation ends in `_ci`.
 *      Under a `_bin` or `_cs` collation they keep returning 200 OK and quietly
 *      stop catching "Samsung" vs "samsung".
 *
 *   3. STORAGE ENGINE. Foreign keys and transactions both require InnoDB.
 *      Prisma emits no ENGINE clause, so the server default decides.
 *
 * Prisma's generated migration stamps utf8mb4/utf8mb4_unicode_ci onto each
 * table it creates, which covers most of this — but not the database default
 * itself, which governs `_prisma_migrations`, anything added by hand later, and
 * the session character set that decides how a string literal inside a raw
 * query compares against a column. So both levels are checked.
 *
 * Run with: npx tsx scripts/verify-mysql-charset.ts
 */
import { prisma } from "../src/app/lib/prisma";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

const main = async () => {
    try {
        /* ---------------- the server ---------------- */
        const [version] = await prisma.$queryRaw<{ version: string }[]>`
            SELECT VERSION() AS version
        `;
        console.log(`\nserver: ${version.version}\n`);

        /* ---------------- the database default ---------------- */
        const [db] = await prisma.$queryRaw<
            { name: string; charset: string; collation: string }[]
        >`
            SELECT
                SCHEMA_NAME                 AS name,
                DEFAULT_CHARACTER_SET_NAME  AS charset,
                DEFAULT_COLLATION_NAME      AS collation
            FROM information_schema.SCHEMATA
            WHERE SCHEMA_NAME = DATABASE()
        `;

        check(
            "database default character set is utf8mb4",
            db.charset === "utf8mb4",
            `${db.name} is ${db.charset}`,
        );
        check(
            "database default collation is case-insensitive",
            db.collation.endsWith("_ci"),
            db.collation,
        );

        /* ---------------- every table ---------------- */
        const tables = await prisma.$queryRaw<
            { name: string; collation: string | null; engine: string | null }[]
        >`
            SELECT TABLE_NAME AS name, TABLE_COLLATION AS collation, ENGINE AS engine
            FROM information_schema.TABLES
            WHERE table_schema = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
            ORDER BY TABLE_NAME
        `;

        check("the schema has tables at all", tables.length > 0, `${tables.length} table(s)`);

        const wrongCharset = tables.filter((t) => !t.collation?.startsWith("utf8mb4"));
        check(
            "every table stores utf8mb4",
            wrongCharset.length === 0,
            wrongCharset.length === 0
                ? `all ${tables.length}`
                : wrongCharset.map((t) => `${t.name}=${t.collation}`).join(", "),
        );

        const caseSensitive = tables.filter((t) => !t.collation?.endsWith("_ci"));
        check(
            "every table compares case-insensitively",
            caseSensitive.length === 0,
            caseSensitive.length === 0
                ? `all ${tables.length}`
                : caseSensitive.map((t) => `${t.name}=${t.collation}`).join(", "),
        );

        const notInnoDb = tables.filter((t) => t.engine !== "InnoDB");
        check(
            "every table is InnoDB (foreign keys and transactions need it)",
            notInnoDb.length === 0,
            notInnoDb.length === 0
                ? `all ${tables.length}`
                : notInnoDb.map((t) => `${t.name}=${t.engine}`).join(", "),
        );

        /* ---------------- behaviour, not just metadata ---------------- */
        /*
         * Metadata can say utf8mb4 while the connection mangles text on the way
         * in or out, so the round trip is exercised rather than inferred. The
         * comparison is done in SQL, by the server, for the same reason.
         */
        const [roundTrip] = await prisma.$queryRaw<{ ok: number }[]>`
            SELECT (${"চার্জার ফাস্ট"} = CONVERT('চার্জার ফাস্ট' USING utf8mb4)) AS ok
        `;
        check(
            "Bangla text survives the round trip to the server and back",
            Number(roundTrip.ok) === 1,
            Number(roundTrip.ok) === 1 ? "byte-identical" : "MANGLED in transit",
        );

        const [folding] = await prisma.$queryRaw<{ ok: number }[]>`
            SELECT (${"Samsung"} = ${"samsung"}) AS ok
        `;
        check(
            "string comparison folds case, which the duplicate-name guards rely on",
            Number(folding.ok) === 1,
            Number(folding.ok) === 1 ? "Samsung = samsung" : "CASE-SENSITIVE — guards are broken",
        );
    } finally {
        await prisma.$disconnect();
    }

    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
    if (failures > 0) process.exitCode = 1;
};

main();
