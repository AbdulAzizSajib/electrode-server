/**
 * Repairs the recorded checksums of migrations that were edited AFTER being
 * applied, so `prisma migrate dev` stops demanding a database reset.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Prisma records a sha256 of each migration file at APPLY time in
 * `_prisma_migrations.checksum`. Editing the file afterwards — for any reason —
 * leaves the recorded hash pointing at content that no longer exists on disk.
 * Prisma then reports:
 *
 *     The migration `<name>` was modified after it was applied.
 *     We need to reset the database at <host>
 *
 * and offers `migrate reset`, which DROPS EVERY ROW IN THE DATABASE. On a
 * shared or production-shaped database that is never the right answer to a
 * checksum mismatch.
 *
 * Under PostgreSQL this drift was routine rather than exceptional: the schema
 * carried three `pg_trgm` GIN indexes that Prisma read as drift and emitted
 * `DROP INDEX` for into every newly generated migration, and those lines had to
 * be hand-deleted before committing. The MySQL schema has no such indexes and
 * no mandated hand-edit, so drift here is now the exception — which raises the
 * bar for running this rather than lowering it. If a migration's checksum has
 * moved, find out why before repairing it.
 *
 * ── What this does, and what it deliberately does not ─────────────────────
 *
 * It recomputes each applied migration's sha256 from the file on disk and,
 * where it differs from the recorded one, UPDATES THE RECORDED VALUE. That is
 * all. It runs no DDL, re-applies no migration, and touches no table other than
 * `_prisma_migrations`.
 *
 * THIS IS ONLY SAFE WHEN THE EDIT IS A NO-OP AGAINST AN ALREADY-MIGRATED
 * DATABASE — a comment, a reformat, a removed statement that had already run.
 * If a migration was edited to add or change real DDL, this script would paper
 * over a database that never ran that DDL. It therefore prints what drifted and
 * requires `--force` before writing anything. Read the summary.
 *
 * A migration recorded as applied whose FILE IS MISSING is reported and never
 * repaired: there is nothing to compute a checksum from, and the right fix is
 * restoring the file from version control.
 *
 * Run with: npx tsx scripts/repair-migration-checksums.ts          (dry run)
 *           npx tsx scripts/repair-migration-checksums.ts --force  (writes)
 *
 * Run it from `server/` — it resolves `.env` and `prisma/migrations/` relative
 * to the working directory.
 */

import "dotenv/config";
import mariadb from "mariadb";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");

type Row = {
    id: string;
    migration_name: string;
    checksum: string;
    finished_at: Date | null;
    rolled_back_at: Date | null;
};

/** Prisma hashes the raw bytes of migration.sql — not a normalised string. */
const hashFile = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

const main = async () => {
    const force = process.argv.includes("--force");

    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
        console.error("DATABASE_URL is not set. Run this from `server/`, where .env lives.");
        process.exitCode = 1;
        return;
    }

    const connection = await mariadb.createConnection(connectionString);

    try {
        // The driver returns an array of rows plus a `meta` property; the spread
        // drops `meta` so the result iterates as a plain array of rows.
        const rows: Row[] = [
            ...(await connection.query(
                `SELECT id, migration_name, checksum, finished_at, rolled_back_at
                   FROM _prisma_migrations
                  ORDER BY started_at ASC`,
            )),
        ];

        const drifted: { row: Row; computed: string }[] = [];
        const missing: Row[] = [];
        let matched = 0;

        for (const row of rows) {
            /*
             * A rolled-back or never-finished migration is not "applied", so its
             * checksum is not what blocks `migrate dev`. Leaving it alone keeps
             * this script's claim narrow: it only re-points hashes for files
             * that actually produced the current schema.
             */
            if (!row.finished_at || row.rolled_back_at) continue;

            const file = join(MIGRATIONS_DIR, row.migration_name, "migration.sql");

            if (!existsSync(file)) {
                missing.push(row);
                continue;
            }

            const computed = hashFile(file);

            if (computed === row.checksum) {
                matched += 1;
                continue;
            }

            drifted.push({ row, computed });
        }

        console.log(`\nApplied migrations checked: ${matched + drifted.length + missing.length}`);
        console.log(`  up to date: ${matched}`);
        console.log(`  drifted:    ${drifted.length}`);
        console.log(`  file gone:  ${missing.length}\n`);

        for (const row of missing) {
            console.warn(
                `  ! ${row.migration_name} — recorded as applied but migration.sql is missing.` +
                    ` NOT repaired; restore the file from version control.`,
            );
        }

        if (drifted.length === 0) {
            console.log("Nothing to repair.\n");
            return;
        }

        for (const { row, computed } of drifted) {
            const file = join(MIGRATIONS_DIR, row.migration_name, "migration.sql");
            const text = readFileSync(file, "utf8");

            /*
             * Comments are excluded from the count on purpose: a migration whose
             * NOTE block merely mentions DDL would otherwise be flagged, and a
             * warning that fires on correct files trains the reader to ignore it.
             */
            const executableDdl = text
                .split("\n")
                .filter((line) => !line.trim().startsWith("--"))
                .filter((line) => /\b(DROP|ALTER|CREATE)\b/i.test(line)).length;

            console.log(`  ~ ${row.migration_name}`);
            console.log(`      recorded: ${row.checksum}`);
            console.log(`      on disk:  ${computed}`);
            console.log(`      file contains ${executableDdl} executable DDL statement(s).`);
        }

        if (!force) {
            console.log(
                "\nDry run — nothing was written.\n" +
                    "Read the summary above. A drifted file should differ from what was applied\n" +
                    "ONLY by edits that are no-ops against an already-migrated database. If one\n" +
                    "of them gained or changed real DDL, do NOT run with --force: that DDL never\n" +
                    "ran against this database, and re-pointing the checksum would hide that.\n\n" +
                    "To apply: npx tsx scripts/repair-migration-checksums.ts --force\n",
            );
            return;
        }

        for (const { row, computed } of drifted) {
            await connection.query(`UPDATE _prisma_migrations SET checksum = ? WHERE id = ?`, [
                computed,
                row.id,
            ]);
            console.log(`  ✓ repaired ${row.migration_name}`);
        }

        console.log(
            `\nRepaired ${drifted.length} migration(s). No schema was changed and no migration` +
                ` was re-run.\n`,
        );
    } finally {
        await connection.end();
    }
};

await main();
