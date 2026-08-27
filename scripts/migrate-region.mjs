/**
 * One-off region migration: copies every row from SOURCE_DATABASE_URL into
 * TARGET_DATABASE_URL.
 *
 * Why this exists rather than `pg_dump | psql`: no Postgres client tools are
 * installed on this machine, and the dataset is tiny (~11 MB / ~340 rows), so a
 * plain Node copy is faster to run than installing them.
 *
 * The target's schema must already exist (`prisma migrate deploy` against the
 * new database) — this script only moves data, never DDL.
 *
 * Table order is derived from the live foreign-key graph, not hardcoded, so it
 * stays correct as the schema evolves. Self-referencing tables (Category's
 * parentId, for one) can't be satisfied by table ordering alone, so the whole
 * copy runs inside a single transaction with constraints deferred to COMMIT.
 *
 * Safe to re-run: it refuses to touch a target that already holds data unless
 * --truncate is passed.
 */
import "dotenv/config";
import pg from "pg";

const SOURCE = process.env.SOURCE_DATABASE_URL ?? process.env.DATABASE_URL;
const TARGET = process.env.TARGET_DATABASE_URL;
const TRUNCATE = process.argv.includes("--truncate");
const DRY_RUN = process.argv.includes("--dry-run");

if (!SOURCE || (!TARGET && !DRY_RUN)) {
    console.error(
        "Set SOURCE_DATABASE_URL (or DATABASE_URL) and TARGET_DATABASE_URL.\n" +
            "  SOURCE_DATABASE_URL = the old US-East-2 database\n" +
            "  TARGET_DATABASE_URL = the new Singapore database",
    );
    process.exit(1);
}

if (TARGET && SOURCE === TARGET) {
    console.error("SOURCE and TARGET are the same database — refusing to run.");
    process.exit(1);
}

/** Every user table in dependency order: a table always follows the tables it references. */
const orderedTables = async (client) => {
    const { rows: tables } = await client.query(`
        SELECT c.relname AS name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname = 'public'
          AND c.relname NOT LIKE '\\_prisma%'
    `);

    const { rows: deps } = await client.query(`
        SELECT src.relname AS child, tgt.relname AS parent
        FROM pg_constraint con
        JOIN pg_class src ON src.oid = con.conrelid
        JOIN pg_class tgt ON tgt.oid = con.confrelid
        JOIN pg_namespace n ON n.oid = src.relnamespace
        WHERE con.contype = 'f' AND n.nspname = 'public'
    `);

    const names = tables.map((t) => t.name);
    const parents = new Map(names.map((n) => [n, new Set()]));
    for (const { child, parent } of deps) {
        // A self-reference can never be resolved by ordering — deferred
        // constraints handle those instead.
        if (child !== parent && parents.has(child)) parents.get(child).add(parent);
    }

    const sorted = [];
    const done = new Set();
    while (sorted.length < names.length) {
        const ready = names.filter(
            (n) => !done.has(n) && [...parents.get(n)].every((p) => done.has(p)),
        );
        // A cycle between distinct tables — deferred constraints cover it, so
        // emit the rest in any order rather than failing.
        if (ready.length === 0) {
            for (const n of names) if (!done.has(n)) sorted.push(n), done.add(n);
            break;
        }
        for (const n of ready) sorted.push(n), done.add(n);
    }
    return sorted;
};

const quote = (id) => `"${id.replace(/"/g, '""')}"`;

const main = async () => {
    const src = new pg.Client({ connectionString: SOURCE });
    await src.connect();

    // A dry run inspects the source only — it must not require the target to
    // exist yet, which is the whole point of being able to run it first.
    if (DRY_RUN) {
        try {
            const tables = await orderedTables(src);
            console.log(`Found ${tables.length} tables in dependency order.\n`);
            console.log("Dry run — row counts at source:\n");
            let total = 0;
            for (const t of tables) {
                const { rows } = await src.query(`SELECT COUNT(*)::int AS n FROM ${quote(t)}`);
                if (rows[0].n > 0) console.log(`  ${t.padEnd(28)} ${rows[0].n}`);
                total += rows[0].n;
            }
            console.log(`\nTotal: ${total} rows. Nothing written, target not contacted.`);
        } finally {
            await src.end();
        }
        return;
    }

    const tgt = new pg.Client({ connectionString: TARGET });
    await tgt.connect();

    try {
        const tables = await orderedTables(src);
        console.log(`Found ${tables.length} tables in dependency order.\n`);

        // Guard: never silently merge into a populated target.
        const occupied = [];
        for (const t of tables) {
            const { rows } = await tgt.query(`SELECT 1 FROM ${quote(t)} LIMIT 1`);
            if (rows.length > 0) occupied.push(t);
        }

        if (occupied.length > 0 && !TRUNCATE) {
            console.error(
                `Target already has data in: ${occupied.join(", ")}\n` +
                    `Re-run with --truncate to clear the target first, or point at an empty database.`,
            );
            process.exit(1);
        }

        await tgt.query("BEGIN");
        // Ordering handles table-to-table dependencies; deferring covers
        // self-references and any cycle within a single table's own data.
        await tgt.query("SET CONSTRAINTS ALL DEFERRED");

        if (occupied.length > 0) {
            console.log(`Truncating ${occupied.length} table(s) on target...`);
            await tgt.query(
                `TRUNCATE ${tables.map(quote).join(", ")} RESTART IDENTITY CASCADE`,
            );
        }

        let grandTotal = 0;
        for (const table of tables) {
            const { rows } = await src.query(`SELECT * FROM ${quote(table)}`);
            if (rows.length === 0) continue;

            const columns = Object.keys(rows[0]);
            const colSql = columns.map(quote).join(", ");

            // Batched multi-row INSERT — at this size one statement per table is
            // plenty, and it keeps the round trips (245ms each) down.
            const BATCH = 500;
            for (let i = 0; i < rows.length; i += BATCH) {
                const slice = rows.slice(i, i + BATCH);
                const values = [];
                const placeholders = slice.map(
                    (row, r) =>
                        `(${columns
                            .map((c, j) => {
                                values.push(row[c]);
                                return `$${r * columns.length + j + 1}`;
                            })
                            .join(", ")})`,
                );
                await tgt.query(
                    `INSERT INTO ${quote(table)} (${colSql}) VALUES ${placeholders.join(", ")}`,
                    values,
                );
            }

            grandTotal += rows.length;
            console.log(`  ${table.padEnd(28)} ${rows.length} rows`);
        }

        await tgt.query("COMMIT");
        console.log(`\nCopied ${grandTotal} rows.`);

        // Verify rather than trust: compare counts table by table.
        console.log("\nVerifying...");
        let mismatch = false;
        for (const table of tables) {
            const [a, b] = await Promise.all([
                src.query(`SELECT COUNT(*)::int AS n FROM ${quote(table)}`),
                tgt.query(`SELECT COUNT(*)::int AS n FROM ${quote(table)}`),
            ]);
            if (a.rows[0].n !== b.rows[0].n) {
                console.error(`  MISMATCH ${table}: source ${a.rows[0].n}, target ${b.rows[0].n}`);
                mismatch = true;
            }
        }
        console.log(mismatch ? "Verification FAILED." : "All table counts match.");
        if (mismatch) process.exitCode = 1;
    } catch (error) {
        await tgt.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        await src.end();
        await tgt.end();
    }
};

main().catch((error) => {
    console.error("\nMigration failed — target rolled back, source untouched.");
    console.error(error);
    process.exit(1);
});
