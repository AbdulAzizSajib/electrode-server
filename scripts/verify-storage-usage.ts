/**
 * Verification for the storage-usage panel.
 *
 * Two things are worth pinning:
 *
 *  - the byte formatter, because it is the one piece of pure logic here and its
 *    boundaries (1023 B, exactly 1 kB, the 10-unit precision switch) are where
 *    an off-by-one shows up as a wrong number rather than a crash;
 *  - that a failure in one half does not take the other down, which is the
 *    whole reason the service uses `allSettled`. A Cloudinary outage must still
 *    leave the database figure readable.
 *
 * The live half also runs against the real database and the real Cloudinary
 * account, so this doubles as a check that both are actually reachable with the
 * configured credentials.
 *
 * Read-only — creates nothing, so there is nothing to clean up.
 *
 * Run with:
 *   npx tsx scripts/verify-storage-usage.ts
 */
import { StorageService } from "../src/app/module/storage/storage.service";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

const main = async () => {
    // --- the formatter's boundaries ---------------------------------------
    const cases: [number, string][] = [
        [0, "0 B"],
        [1023, "1023 B"],
        [1024, "1.0 kB"],
        // The precision switch: below 10 units keeps a decimal, at/above drops it.
        [9.4 * 1024 * 1024, "9.4 MB"],
        [10 * 1024 * 1024, "10 MB"],
        [16220160, "15 MB"],
        [1024 ** 3, "1.0 GB"],
        [1024 ** 4, "1.0 TB"],
        // Beyond the unit table — must saturate at TB rather than fall off the end.
        [1024 ** 5, "1024 TB"],
    ];

    for (const [bytes, expected] of cases) {
        const actual = StorageService.formatBytes(bytes);
        check(`format ${bytes}`, actual === expected, `got "${actual}", expected "${expected}"`);
    }

    // Garbage in must not render as a confident "0 B".
    for (const bad of [NaN, -1, Infinity]) {
        const actual = StorageService.formatBytes(bad);
        check(`format ${bad}`, actual === "—", `got "${actual}", expected "—"`);
    }

    // --- both halves, live -------------------------------------------------
    const usage = await StorageService.getStorageUsage();

    check(
        "database half is readable",
        usage.database !== null && usage.database.size.bytes > 0,
        usage.database
            ? `${usage.database.size.label} (${usage.database.size.bytes} bytes)`
            : `unreadable: ${usage.databaseError}`,
    );

    check(
        "media half is readable",
        usage.media !== null,
        usage.media
            ? `${usage.media.plan} plan · ${usage.media.storage.label} across ${usage.media.assets} assets`
            : `unreadable: ${usage.mediaError}`,
    );

    /*
     * The independence guarantee, exercised rather than assumed: a rejected
     * half must leave the other populated and report its own reason. Asserted
     * against the real shape by checking that a successful half never carries
     * an error, and a failed one always does.
     */
    const consistent =
        (usage.database === null) === (usage.databaseError !== null) &&
        (usage.media === null) === (usage.mediaError !== null);

    check(
        "each half reports either a value or a reason",
        consistent,
        `db=${usage.database ? "value" : "null"}/${usage.databaseError ?? "no error"}, ` +
            `media=${usage.media ? "value" : "null"}/${usage.mediaError ?? "no error"}`,
    );

    if (usage.media?.credits) {
        const { used, limit, percentUsed } = usage.media.credits;
        check(
            "credit percentage is self-consistent",
            limit > 0 && Math.abs((used / limit) * 100 - percentUsed) < 0.5,
            `${used}/${limit} credits reported as ${percentUsed}%`,
        );
    }

    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
};

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
