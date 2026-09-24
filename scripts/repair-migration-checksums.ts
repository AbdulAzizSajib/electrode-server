/**
 * Repairs the recorded checksums of migrations that were edited AFTER being
 * applied, so `prisma migrate dev` stops demanding a database reset.
 *
 * ── Why this drift is normal here, and will keep happening ────────────────
 *
 * This repo mandates a hand-edit of generated migration SQL. Prisma reads the
 * three `pg_trgm` GIN indexes as drift and emits `DROP INDEX` for them into
 * newly generated migrations; CLAUDE.md requires deleting those lines and
 * carrying forward the NOTE block before committing. That edit is correct and
 * load-bearing — committing the drops silently degrades
 * `ProductService.searchProducts` to a sequential scan.
 *
 * But Prisma records a sha256 of each migration file at APPLY time in
 * `_prisma_migrations.checksum`. Editing the file afterwards — for any reason,
 * including the mandated one — leaves the recorded hash pointing at content
 * that no longer exists on disk. Prisma then reports:
 *
 *     The migration `<name>` was modified after it was applied.
 *     We need to reset the "public" schema at <host>
 *
 * and offers `migrate reset`, which DROPS EVERY ROW IN THE DATABASE. On a
 * shared or production-shaped database that is never the right answer to a
 * checksum mismatch.
 *
 * ── What this does, and what it deliberately does not ─────────────────────
 *
 * It recomputes each applied migration's sha256 from the file on disk and,
 * where it differs from the recorded one, UPDATES THE RECORDED VALUE. That is
 * all. It runs no DDL, re-applies no migration, and touches no table other than
 * `_prisma_migrations`.
 *
 * THIS IS ONLY SAFE BECAUSE THE EDITS ARE KNOWN TO BE NO-OPS AGAINST AN
 * ALREADY-MIGRATED DATABASE. Removing a `DROP INDEX` line from an applied
 * migration changes what that file WOULD do if replayed from scratch; it
 * changes nothing about the database that already ran it. Re-pointing the
 * checksum therefore records the truth: this file is the one that produced this
 * schema.
 *
 * It is NOT a general "make Prisma stop complaining" tool. If a migration was
 * edited to add or change real DDL, this script would paper over a database
 * that never ran that DDL — so it prints a unified diff summary of what changed
 * and requires `--force` before writing anything. Read the summary.
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
import pg from "pg";
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

    const client = new pg.Client({ connectionString });
    await client.connect();

    try {
        const { rows } = await client.query<Row>(
            `SELECT id, migration_name, checksum, finished_at, rolled_back_at
               FROM _prisma_migrations
              ORDER BY started_at ASC`,
        );

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
             * COMMENTS ARE EXCLUDED, and that is not a nicety. Every migration
             * in this repo carries a NOTE block that DESCRIBES the trigram
             * hazard, and that prose contains the words "DROP INDEX". A naive
             * line match therefore flags the very files that were edited
             * correctly — reporting "1 DROP INDEX line" for a file whose only
             * occurrence is `-- NOTE: the DROP INDEX statements ... were
             * removed`. A warning that fires on every correct file trains the
             * reader to ignore it, which is worse than no warning at all.
             */
            const dropIndexStatements = text
                .split("\n")
                .filter((line) => !line.trim().startsWith("--"))
                .filter((line) => /DROP\s+INDEX/i.test(line)).length;

            console.log(`  ~ ${row.migration_name}`);
            console.log(`      recorded: ${row.checksum}`);
            console.log(`      on disk:  ${computed}`);
            console.log(
                dropIndexStatements === 0
                    ? "      no executable DROP INDEX — consistent with the mandated edit."
                    : `      CHECK THIS: ${dropIndexStatements} executable DROP INDEX statement(s) remain.`,
            );
        }

        if (!force) {
            console.log(
                "\nDry run — nothing was written.\n" +
                    "Read the summary above. Every drifted file should differ from what was\n" +
                    "applied ONLY by edits that are no-ops against an already-migrated database\n" +
                    "(the trigram DROP INDEX removal, comments, the NOTE block). If one of them\n" +
                    "gained or changed real DDL, do NOT run with --force: that DDL never ran\n" +
                    "against this database, and re-pointing the checksum would hide that.\n\n" +
                    "To apply: npx tsx scripts/repair-migration-checksums.ts --force\n",
            );
            return;
        }

        for (const { row, computed } of drifted) {
            await client.query(`UPDATE _prisma_migrations SET checksum = $1 WHERE id = $2`, [
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
        await client.end();
    }
};

await main();
