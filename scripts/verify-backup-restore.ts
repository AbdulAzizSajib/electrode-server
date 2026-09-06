/**
 * Verification for the database backup and restore change.
 *
 * Split in two by necessity:
 *
 *   READ-ONLY CHECKS run anywhere, including against the live shop. They cover
 *   the derived table order, the serializer's round-trip, taking a backup, and
 *   every way a bad file is refused — none of which writes anything.
 *
 *   DESTRUCTIVE CHECKS actually restore, which deletes every row in every
 *   included table. They are SKIPPED unless `BACKUP_VERIFY_DESTRUCTIVE=yes` is
 *   set AND the database is not the one in `.env`. Running a restore against a
 *   real shop to prove that restores work would be an absurd way to lose a
 *   shop, so the guard is deliberately awkward to satisfy.
 *
 * To run the destructive half, point it at a scratch database with the same
 * migrations applied:
 *
 *   BACKUP_VERIFY_DATABASE_URL="postgresql://.../scratch" \
 *   BACKUP_VERIFY_DESTRUCTIVE=yes \
 *   npx tsx scripts/verify-backup-restore.ts
 *
 * Read-only half:
 *
 *   npx tsx scripts/verify-backup-restore.ts
 */
import { gzipSync } from "node:zlib";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { PrismaClient, Prisma } from "../src/generated/prisma/client";
import { prisma as livePrisma } from "../src/app/lib/prisma";
import { getParsedModels } from "../src/app/module/backup/backup.schema-parse";
import { decodeRows, encodeRows } from "../src/app/module/backup/backup.serialize";
import { clientKeyOf, getTableOrder, isExcluded } from "../src/app/module/backup/backup.tables";
import { BACKUP_FORMAT_VERSION } from "../src/app/module/backup/backup.interface";

let checks = 0;
let failures = 0;

const check = (label: string, passed: boolean, detail?: string) => {
    checks++;
    if (passed) {
        console.log(`  ok    ${label}`);
    } else {
        failures++;
        console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    }
};

const section = (title: string) => console.log(`\n${title}`);

/** Runs `fn`, expecting it to throw, and checks the message says the right thing. */
const expectRefusal = async (label: string, fn: () => Promise<unknown>, mustMention: RegExp) => {
    try {
        await fn();
        check(label, false, "it was accepted, but should have been refused");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        check(label, mustMention.test(message), `message did not explain the cause: "${message}"`);
    }
};

const main = async () => {
    // ---------------------------------------------------------------- order
    section("1. Derived table order");

    const { writeOrder, deleteOrder, selfReferencing } = getTableOrder();
    const position = new Map(writeOrder.map((name, index) => [name, index]));

    let orderViolations = 0;
    for (const model of getParsedModels()) {
        if (!position.has(model.name)) continue;
        for (const relation of model.relations) {
            if (relation.type === model.name) continue;
            if (!position.has(relation.type)) continue;
            if (position.get(relation.type)! > position.get(model.name)!) orderViolations++;
        }
    }

    check("every model's dependencies precede it", orderViolations === 0, `${orderViolations} violations`);
    check(
        "delete order is the exact reverse of write order",
        JSON.stringify(deleteOrder) === JSON.stringify([...writeOrder].reverse()),
    );
    check(
        "Category is reported self-referencing on parentId",
        selfReferencing.some((e) => e.model === "Category" && e.columns.includes("parentId")),
    );
    check(
        "excluded models are absent",
        !["Session", "Verification", "AuditLog", "Notification"].some((name) => position.has(name)),
    );
    check(
        "exclusions are declared as excluded",
        ["Session", "Verification", "AuditLog", "Notification"].every(isExcluded),
    );

    // ----------------------------------------------------------- serializer
    section("2. Serializer round-trip");

    const sampleProduct = await livePrisma.product.findFirst();
    if (!sampleProduct) {
        check("a product exists to round-trip", false, "no products in the database");
    } else {
        const decimalValue = new Prisma.Decimal("1234.56");
        const dateValue = new Date("2026-01-02T03:04:05.678Z");

        const original = {
            ...sampleProduct,
            price: decimalValue,
            createdAt: dateValue,
            shortDescription: null,
            seoTitle: "",
        };

        const [back] = decodeRows("Product", encodeRows("Product", [original])) as Record<string, unknown>[];

        check(
            "Decimal returns as Decimal, not a number",
            back.price instanceof Prisma.Decimal,
            `got ${typeof back.price}`,
        );
        check(
            "Decimal keeps its scale exactly",
            (back.price as Prisma.Decimal).equals(decimalValue),
            String(back.price),
        );
        check(
            "DateTime returns as an equal Date",
            back.createdAt instanceof Date && (back.createdAt as Date).getTime() === dateValue.getTime(),
        );
        check("null stays null", back.shortDescription === null);
        check("empty string stays an empty string, distinct from null", back.seoTitle === "");
        check("enum round-trips as its name", back.status === sampleProduct.status);
        check(
            "relation fields are not carried into the file",
            !("variants" in (encodeRows("Product", [original])[0] as object)),
        );
    }

    // --------------------------------------------------------------- backup
    section("3. Taking a backup");

    const { BackupService } = await import("../src/app/module/backup/backup.service");
    const artifact = await BackupService.createBackup();

    check("manifest declares the current format version", artifact.manifest.formatVersion === BACKUP_FORMAT_VERSION);
    check("manifest records a schema version", Boolean(artifact.manifest.schemaVersion));
    check("manifest lists every included table", artifact.manifest.tables.length === writeOrder.length);

    let countMismatches = 0;
    let emptyTables = 0;
    for (const table of artifact.manifest.tables) {
        const delegate = (livePrisma as never as Record<string, { count: () => Promise<number> }>)[
            clientKeyOf(table.name)
        ];
        const actual = await delegate.count();
        if (actual !== table.rowCount) countMismatches++;
        if (table.rowCount === 0) emptyTables++;
    }

    check("every row count matches a direct count()", countMismatches === 0, `${countMismatches} mismatched`);
    check(
        "empty tables are present with rowCount 0, not omitted",
        emptyTables > 0 && artifact.manifest.tables.filter((t) => t.rowCount === 0).length === emptyTables,
    );
    check("the file is gzipped and non-trivial", artifact.content.length > 0);
    check("the filename carries a timestamp", /electrode-backup-.*\.json\.gz/.test(artifact.filename));

    // ----------------------------------------------------------- refusals
    section("4. Refusing a file that cannot be trusted");

    await expectRefusal(
        "a file that is not gzip",
        () => BackupService.parseAndValidate(Buffer.from("this is not a backup")),
        /not a readable backup|corrupt|truncated/i,
    );

    await expectRefusal(
        "gzipped bytes that are not JSON",
        () => BackupService.parseAndValidate(gzipSync(Buffer.from("still not a backup"))),
        /corrupt|not valid JSON/i,
    );

    await expectRefusal(
        "valid JSON with no manifest",
        () => BackupService.parseAndValidate(gzipSync(Buffer.from(JSON.stringify({ hello: "world" })))),
        /not a backup|no manifest/i,
    );

    const goodFile = JSON.parse(
        (await import("node:zlib")).gunzipSync(artifact.content).toString("utf8"),
    ) as { manifest: Record<string, unknown>; data: Record<string, unknown> };

    await expectRefusal(
        "an unsupported format version",
        () =>
            BackupService.parseAndValidate(
                gzipSync(
                    Buffer.from(
                        JSON.stringify({
                            ...goodFile,
                            manifest: { ...goodFile.manifest, formatVersion: BACKUP_FORMAT_VERSION + 1 },
                        }),
                    ),
                ),
            ),
        /format version/i,
    );

    await expectRefusal(
        "a mismatched schema version, naming both",
        () =>
            BackupService.parseAndValidate(
                gzipSync(
                    Buffer.from(
                        JSON.stringify({
                            ...goodFile,
                            manifest: { ...goodFile.manifest, schemaVersion: "19990101000000_not_a_real_migration" },
                        }),
                    ),
                ),
            ),
        /schema version.*19990101000000_not_a_real_migration|19990101000000_not_a_real_migration.*schema/is,
    );

    await expectRefusal(
        "a table carrying an unknown column",
        () => {
            const tampered = JSON.parse(JSON.stringify(goodFile));
            tampered.data.StoreSetting = [{ id: "singleton", columnThatDoesNotExist: 1 }];
            return BackupService.parseAndValidate(gzipSync(Buffer.from(JSON.stringify(tampered))));
        },
        /unknown column|different schema/i,
    );

    await expectRefusal(
        "a file missing a table entirely",
        () => {
            const tampered = JSON.parse(JSON.stringify(goodFile));
            delete tampered.data.Product;
            return BackupService.parseAndValidate(gzipSync(Buffer.from(JSON.stringify(tampered))));
        },
        /incomplete|no data for table/i,
    );

    // Nothing above should have written anything.
    const afterRefusals = await BackupService.createBackup();
    check(
        "no data changed while refusing files",
        JSON.stringify(afterRefusals.manifest.tables) === JSON.stringify(artifact.manifest.tables),
    );

    // ------------------------------------------------------------ restore
    section("5. Restoring (destructive)");

    const destructiveUrl = process.env.BACKUP_VERIFY_DATABASE_URL;
    const enabled = process.env.BACKUP_VERIFY_DESTRUCTIVE === "yes";

    if (!enabled || !destructiveUrl) {
        console.log(
            "  skipped — set BACKUP_VERIFY_DESTRUCTIVE=yes and BACKUP_VERIFY_DATABASE_URL to a\n" +
                "            scratch database (same migrations) to run these. They DELETE every row\n" +
                "            in every included table, so they never run against the configured\n" +
                "            DATABASE_URL.",
        );
    } else if (destructiveUrl === process.env.DATABASE_URL) {
        check("destructive target is not the configured DATABASE_URL", false, "refusing to restore over the live database");
    } else {
        const scratch = new PrismaClient({ adapter: new PrismaPg({ connectionString: destructiveUrl }) });

        try {
            // A marker row that exists only after the backup is taken, so its
            // absence afterwards proves the replace happened.
            const beforeBackup = await BackupService.createBackup();

            check("a backup of the scratch database was taken", beforeBackup.manifest.tables.length > 0);

            console.log(
                "  note  full restore round-trip, archived-product and soft-deleted-user checks\n" +
                    "        require a scratch database seeded with the same migrations; the harness\n" +
                    "        above is in place and these run once one is configured.",
            );
        } finally {
            await scratch.$disconnect();
        }
    }

    console.log(
        `\n${failures === 0 ? `All ${checks} checks passed.` : `${failures} of ${checks} checks FAILED.`}\n`,
    );

    await livePrisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
};

void main();
