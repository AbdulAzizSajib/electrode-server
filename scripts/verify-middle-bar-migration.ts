/**
 * Exercises the `add_middle_bar_links` data move against a real Postgres
 * engine, without touching any live database.
 *
 * That migration rewrites a Json column on EVERY StoreSetting row — moving an
 * announcement-bar link targeting `/track-order` into `middleBarLinks` — and
 * `announcementBar` is the shop's header. Getting it wrong corrupts the header
 * of every store at once, and Postgres constrains nothing inside a Json column,
 * so there is no database-level safety net to catch a malformed rewrite.
 *
 * Runs the migration's OWN SQL, read from the migration file rather than
 * retyped here. A copy would drift from the statement that actually ships,
 * which would make this script worse than useless: it would pass while the
 * migration was broken.
 *
 * Uses PGlite — the real Postgres engine, in-process — so `jsonb_set`,
 * `jsonb_agg` and the `->>` operators behave exactly as they will on Neon. A
 * hand-rolled JS simulation of the same logic would test the simulation.
 *
 * TOUCHES NO DATABASE and needs no running server, like
 * verify-revalidate-tags.ts and unlike most scripts here. It creates a
 * throwaway in-memory table, so there is nothing to clean up and no
 * `__verify_`-prefixed row to leave behind.
 *
 * The cases that matter are the malformed and already-migrated ones. The happy
 * path is the one that was always going to work.
 *
 * Run with: npx tsx scripts/verify-middle-bar-migration.ts
 *
 * See openspec/changes/add-header-middle-bar-links, design.md Decision 2.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.join(
    here,
    "../prisma/migrations/20260920130000_add_middle_bar_links/migration.sql",
);

const sql = readFileSync(MIGRATION, "utf8");

/*
 * The data move on its own. The ALTER TABLE is dropped because the fixture
 * table below already declares the column — and because the move is the part
 * with the risk in it. Sliced from the real file so this cannot drift.
 */
const marker = 'UPDATE "StoreSetting"';
const dataMove = sql.slice(sql.indexOf(marker));

if (!dataMove.startsWith(marker)) {
    throw new Error(
        `Could not find '${marker}' in ${MIGRATION}. If the migration was rewritten, update this script.`,
    );
}

if (/^\s*DROP INDEX/im.test(sql)) {
    /*
     * The repo-wide hazard: Prisma emits DROP INDEX for the three pg_trgm
     * indexes into generated migrations, and committing them degrades product
     * search to a sequential scan with nothing failing loudly. Cheap to assert
     * here while this file is open anyway.
     */
    throw new Error(`${MIGRATION} contains a DROP INDEX statement — see the NOTE block in it.`);
}

const PHONE = {
    icon: "akar-icons:whatsapp-fill",
    label: "+8801782521705",
    href: "https://wa.me/8801782521705",
    source: "contactPhone",
};
const EMAIL = {
    icon: "garden:email-stroke-16",
    label: "contact@sheisite.com",
    href: "mailto:contact@sheisite.com",
    source: "contactEmail",
};
const TRACK = { icon: "fa-solid:truck", label: "Track Order", href: "/track-order" };

/** id, announcementBar, middleBarLinks */
const FIXTURES: [string, unknown, unknown][] = [
    // The ordinary shop: phone, email, Track Order.
    ["typical", { enabled: true, text: "Free delivery", links: [PHONE, EMAIL, TRACK] }, null],
    // Never had one — must come out untouched, with nothing invented.
    ["no-track", { enabled: true, text: "Hi", links: [PHONE, EMAIL] }, null],
    // Renamed by the merchant. Matched on href, so it still moves.
    [
        "renamed",
        { enabled: true, text: "", links: [{ icon: "x", label: "Track my parcel", href: "/track-order" }] },
        null,
    ],
    // Already in both places — a merchant who added it by hand before this ran.
    ["already", { enabled: true, text: "", links: [PHONE, TRACK] }, [TRACK]],
    // Destination already holds something else; Track Order appends after it.
    ["has-other", { enabled: true, text: "", links: [TRACK] }, [{ label: "Support", href: "/contact" }]],
    // The three malformed shapes, each of which must be left completely alone.
    ["null-bar", null, null],
    ["no-links", { enabled: false, text: "Hello" }, null],
    ["links-not-array", { enabled: true, text: "", links: "oops" }, null],
    // Only a Track Order link: the bar must end with an empty array, not null.
    ["only-track", { enabled: true, text: "Sale", links: [TRACK] }, null],
    // A corrupt destination must not stop the move.
    ["mbl-corrupt", { enabled: true, text: "", links: [TRACK] }, "garbage"],
];

/**
 * What the fixture table returns. Deliberately loose: half these rows hold
 * shapes the Zod schema would reject, which is the point of them.
 */
type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };
type Row = { id: string; announcementBar: JsonValue; middleBarLinks: JsonValue };

/** Narrows a fixture's column to the object shape a check is about to read. */
const asRecord = (value: JsonValue): Record<string, JsonValue> =>
    value as Record<string, JsonValue>;
const asList = (value: JsonValue): Record<string, JsonValue>[] =>
    value as Record<string, JsonValue>[];

let failures = 0;

function check(name: string, passed: boolean, detail: string) {
    if (passed) {
        console.log(`  ok   ${name}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${name}\n         ${detail}`);
    }
}

const hrefs = (links: JsonValue) =>
    Array.isArray(links) ? links.map((l) => asRecord(l).href) : links;

async function main() {
    const db = new PGlite();

    await db.exec(`
        CREATE TABLE "StoreSetting" (
            id TEXT PRIMARY KEY,
            "announcementBar" JSONB,
            "middleBarLinks" JSONB
        );
    `);

    for (const [id, bar, mbl] of FIXTURES) {
        await db.query(
            'INSERT INTO "StoreSetting" (id, "announcementBar", "middleBarLinks") VALUES ($1, $2, $3)',
            [id, bar === null ? null : JSON.stringify(bar), mbl === null ? null : JSON.stringify(mbl)],
        );
    }

    const snapshot = async (): Promise<Record<string, Row>> => {
        const { rows } = await db.query<Row>(
            'SELECT id, "announcementBar", "middleBarLinks" FROM "StoreSetting" ORDER BY id',
        );
        return Object.fromEntries(rows.map((r) => [r.id, r]));
    };

    const before = await snapshot();
    const first = await db.query(dataMove);
    const after = await snapshot();
    // Idempotence is the property an operator restoring a backup depends on.
    const second = await db.query(dataMove);
    const afterTwice = await snapshot();

    console.log(
        `\nRows affected: first run ${first.affectedRows}, second run ${second.affectedRows}\n`,
    );

    check(
        "typical: the entry left the announcement bar",
        JSON.stringify(hrefs(asRecord(after.typical.announcementBar).links)) ===
            JSON.stringify([PHONE.href, EMAIL.href]),
        JSON.stringify(asRecord(after.typical.announcementBar).links),
    );
    check(
        "typical: it arrived with its label and icon",
        asList(after.typical.middleBarLinks).length === 1 &&
            asList(after.typical.middleBarLinks)[0].label === "Track Order" &&
            asList(after.typical.middleBarLinks)[0].icon === "fa-solid:truck",
        JSON.stringify(after.typical.middleBarLinks),
    );
    check(
        "typical: `source` is not carried across",
        !("source" in asList(after.typical.middleBarLinks)[0]),
        JSON.stringify(asList(after.typical.middleBarLinks)[0]),
    );
    check(
        "typical: the bar's text and enabled flag are untouched",
        asRecord(after.typical.announcementBar).text === "Free delivery" &&
            asRecord(after.typical.announcementBar).enabled === true,
        JSON.stringify(after.typical.announcementBar),
    );

    check(
        "no-track: the row is byte-identical",
        JSON.stringify(after["no-track"]) === JSON.stringify(before["no-track"]),
        JSON.stringify(after["no-track"]),
    );
    check(
        "no-track: no entry was invented",
        after["no-track"].middleBarLinks === null,
        JSON.stringify(after["no-track"].middleBarLinks),
    );

    check(
        "renamed: moved on href, keeping the merchant's label",
        asList(after.renamed.middleBarLinks)?.[0]?.label === "Track my parcel" &&
            asList(asRecord(after.renamed.announcementBar).links).length === 0,
        JSON.stringify(after.renamed),
    );

    check(
        "already: no duplicate entry created",
        asList(after.already.middleBarLinks).length === 1,
        JSON.stringify(after.already.middleBarLinks),
    );
    check(
        "already: the bar's copy is removed anyway, so it cannot render twice",
        (hrefs(asRecord(after.already.announcementBar).links) as string[]).indexOf("/track-order") === -1,
        JSON.stringify(asRecord(after.already.announcementBar).links),
    );

    check(
        "has-other: appended after the existing entry, not in front of it",
        JSON.stringify(hrefs(after["has-other"].middleBarLinks)) ===
            JSON.stringify(["/contact", "/track-order"]),
        JSON.stringify(after["has-other"].middleBarLinks),
    );

    for (const id of ["null-bar", "no-links", "links-not-array"]) {
        check(
            `${id}: malformed shape left completely alone`,
            JSON.stringify(after[id]) === JSON.stringify(before[id]),
            JSON.stringify(after[id]),
        );
    }

    check(
        "only-track: the bar keeps an empty array rather than becoming null",
        Array.isArray(asRecord(after["only-track"].announcementBar).links) &&
            asList(asRecord(after["only-track"].announcementBar).links).length === 0,
        JSON.stringify(after["only-track"].announcementBar),
    );

    check(
        "mbl-corrupt: a corrupt destination is replaced by a valid array",
        Array.isArray(after["mbl-corrupt"].middleBarLinks) &&
            (hrefs(after["mbl-corrupt"].middleBarLinks) as string[])[0] === "/track-order",
        JSON.stringify(after["mbl-corrupt"].middleBarLinks),
    );

    check(
        "idempotent: running it a second time changes nothing",
        JSON.stringify(after) === JSON.stringify(afterTwice) && second.affectedRows === 0,
        `second run affected ${second.affectedRows} row(s)`,
    );

    console.log("");
    if (failures > 0) {
        console.error(`${failures} check(s) failed.`);
        process.exit(1);
    }
    console.log("All checks passed.");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
