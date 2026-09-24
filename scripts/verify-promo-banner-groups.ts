/**
 * Verification for merchant-created promo banner groups.
 *
 * Two halves, because the change has two kinds of risk:
 *
 * ── Part 1: reconcileHomeConfig, PURE, no database ────────────────────────
 *
 * `MID_BANNERS` is now the one section key that may appear more than once, so
 * the identity of a config entry changed from `key` to `key:groupId` — for that
 * key alone. Every failure in this area is SILENT and shows up as a merchant's
 * homepage quietly missing a section they configured:
 *
 *  - two distinct promo entries must BOTH survive (the whole feature);
 *  - two entries naming the SAME group must collapse to one, because the
 *    ambiguity the original duplicate rule rejected is still ambiguous;
 *  - a repeated FIXED key must still collapse — the exception is for one key,
 *    not a weakening of the rule;
 *  - an entry naming a deleted group must be DROPPED, since deleting a group
 *    deliberately writes nothing to StoreSetting, making this the only thing
 *    that removes the strip;
 *  - an entry with a missing or non-string groupId must be dropped for the same
 *    reason it would be unrenderable;
 *  - a group that exists but is named by no entry must be SPLICED IN enabled,
 *    which is what makes creating a strip enough to put it on the page;
 *  - a disabled promo entry must STAY disabled — the splice must not resurrect
 *    a section the merchant deliberately switched off.
 *
 * ── Part 2: the round trip, against the real database ─────────────────────
 *
 *  - deleting a group DETACHES its banners rather than deleting them, which is
 *    `onDelete: SetNull` doing its job and is the difference between a merchant
 *    losing an arrangement and losing artwork;
 *  - a non-MID banner cannot be assigned to a group;
 *  - an unknown layout resolves to THREE rather than reaching a storefront that
 *    has no grid class for it;
 *  - AND THE ONE THAT MATTERS MOST: a config round-tripped through the admin's
 *    write schema PRESERVES `groupId`. The admin's Home Sections editor filters
 *    the stored list and writes it back, so an entry that loses its groupId on
 *    that path is dropped by the very next read — every promo strip disappears
 *    on the first unrelated save, with no error anywhere.
 *
 * Imports the services directly — no HTTP — per the repo's testing approach.
 * Creates `__verify_*`-prefixed rows and removes them in a `finally`.
 *
 * Run with:
 *   npx tsx scripts/verify-promo-banner-groups.ts
 */
import { prisma } from "../src/app/lib/prisma";
import { BannerService } from "../src/app/module/banner/banner.service";
import { PromoBannerGroupService } from "../src/app/module/promo-banner-group/promo-banner-group.service";
import {
    PROMO_BANNER_LAYOUTS,
    resolvePromoBannerLayout,
} from "../src/app/module/store-setting/store-setting.constant";
import { reconcileHomeConfig } from "../src/app/module/store-setting/store-setting.service";
import { homeConfigSchema } from "../src/app/module/store-setting/store-setting.validation";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

const PREFIX = "__verify_promo_group";

/** Only the promo entries, which is what every assertion below is about. */
const promoEntries = (config: ReturnType<typeof reconcileHomeConfig>) =>
    config.filter((section) => section.key === "MID_BANNERS");

const reconcileChecks = () => {
    console.log("\n-- reconcileHomeConfig (pure) --");

    const A = "group-a";
    const B = "group-b";

    // 1. Two distinct promo entries both survive, in stored order.
    {
        const out = promoEntries(
            reconcileHomeConfig(
                [
                    { key: "HERO", enabled: true },
                    { key: "MID_BANNERS", enabled: true, groupId: A },
                    { key: "FEATURED_PRODUCTS", enabled: true },
                    { key: "MID_BANNERS", enabled: true, groupId: B },
                ],
                [A, B],
            ),
        );

        check(
            "two distinct promo entries kept",
            out.length === 2 && out[0]?.groupId === A && out[1]?.groupId === B,
            `got ${out.length} entries: ${out.map((e) => e.groupId).join(", ")}`,
        );
    }

    // 2. Two entries naming the SAME group collapse to the first.
    {
        const out = promoEntries(
            reconcileHomeConfig(
                [
                    { key: "MID_BANNERS", enabled: true, groupId: A },
                    { key: "MID_BANNERS", enabled: false, groupId: A },
                ],
                [A],
            ),
        );

        check(
            "duplicate group collapses to first occurrence",
            out.length === 1 && out[0]?.enabled === true,
            `got ${out.length} entries, first enabled=${out[0]?.enabled}`,
        );
    }

    // 3. A repeated FIXED key still collapses — the exception is for one key only.
    {
        const out = reconcileHomeConfig(
            [
                { key: "HERO", enabled: true },
                { key: "HERO", enabled: false },
            ],
            [],
        ).filter((section) => section.key === "HERO");

        check(
            "repeated fixed key still deduped",
            out.length === 1 && out[0]?.enabled === true,
            `got ${out.length} HERO entries`,
        );
    }

    // 4. An entry naming a group that no longer exists is dropped.
    {
        const out = promoEntries(
            reconcileHomeConfig([{ key: "MID_BANNERS", enabled: true, groupId: A }], []),
        );

        check("entry naming a deleted group dropped", out.length === 0, `got ${out.length} entries`);
    }

    // 5. A missing or non-string groupId is dropped.
    {
        const out = promoEntries(
            reconcileHomeConfig(
                [
                    { key: "MID_BANNERS", enabled: true },
                    { key: "MID_BANNERS", enabled: true, groupId: 42 },
                ],
                [A],
            ),
        );

        check(
            "malformed groupId dropped",
            out.length === 1 && out[0]?.groupId === A,
            `got ${out.length} entries (the surviving one is the spliced group)`,
        );
    }

    // 6. A group named by no entry is spliced in, enabled.
    {
        const out = promoEntries(
            reconcileHomeConfig([{ key: "MID_BANNERS", enabled: true, groupId: A }], [A, B]),
        );

        check(
            "unplaced group spliced in enabled",
            out.length === 2 && out.some((e) => e.groupId === B && e.enabled),
            `got ${out.map((e) => `${e.groupId}:${e.enabled}`).join(", ")}`,
        );
    }

    /*
     * 7. A DISABLED promo entry stays disabled.
     *
     * The splice must not treat "switched off" as "absent" — that would undo a
     * merchant's deliberate choice on every read, and it is exactly the trap
     * the original reconciler documents for fixed sections.
     */
    {
        const out = promoEntries(
            reconcileHomeConfig([{ key: "MID_BANNERS", enabled: false, groupId: A }], [A]),
        );

        check(
            "disabled promo entry not resurrected",
            out.length === 1 && out[0]?.enabled === false,
            `got enabled=${out[0]?.enabled}`,
        );
    }

    /*
     * 8. A non-array config still yields the groups.
     *
     * A store whose column was never written still HAS its promo groups — and
     * for a store migrated from before this change whose homeConfig was null,
     * this is the only path that places the carried-over group.
     */
    {
        const out = promoEntries(reconcileHomeConfig(null, [A]));

        check(
            "groups spliced into a never-configured store",
            out.length === 1 && out[0]?.groupId === A && out[0]?.enabled === true,
            `got ${out.length} entries`,
        );
    }
};

/**
 * THE ADMIN ROUND TRIP — the highest-consequence check in this file.
 *
 * The admin reads the stored config, filters it against its own registry, and
 * writes the filtered list back on save. If `groupId` does not survive that
 * write schema, every promo strip is dropped by the next read and the merchant
 * loses all of them on their first unrelated save.
 */
const roundTripCheck = () => {
    console.log("\n-- admin write-path round trip --");

    const A = "group-a";
    const B = "group-b";

    const config = [
        { key: "HERO", enabled: true, variant: "SPLIT_THREE" },
        { key: "MID_BANNERS", enabled: true, groupId: A },
        { key: "MID_BANNERS", enabled: false, groupId: B },
    ];

    const parsed = homeConfigSchema.safeParse(config);

    check(
        "write schema accepts repeated MID_BANNERS with distinct groups",
        parsed.success,
        parsed.success ? "accepted" : JSON.stringify(parsed.error.issues),
    );

    if (parsed.success) {
        const promo = parsed.data.filter((s) => s.key === "MID_BANNERS");
        check(
            "groupId survives the write schema",
            promo.length === 2 && promo[0]?.groupId === A && promo[1]?.groupId === B,
            `got ${promo.map((e) => e.groupId).join(", ")}`,
        );

        const reconciled = promoEntries(reconcileHomeConfig(parsed.data, [A, B]));
        check(
            "reconcile after write preserves both entries and their enabled flags",
            reconciled.length === 2 &&
                reconciled[0]?.enabled === true &&
                reconciled[1]?.enabled === false,
            `got ${reconciled.map((e) => `${e.groupId}:${e.enabled}`).join(", ")}`,
        );
    }

    // The same group twice must still be rejected on the WRITE path.
    const dupe = homeConfigSchema.safeParse([
        { key: "MID_BANNERS", enabled: true, groupId: A },
        { key: "MID_BANNERS", enabled: true, groupId: A },
    ]);

    check(
        "write schema rejects the same group listed twice",
        !dupe.success,
        dupe.success ? "wrongly accepted" : "rejected",
    );

    // A promo entry with no group must be rejected rather than silently dropped later.
    const groupless = homeConfigSchema.safeParse([{ key: "MID_BANNERS", enabled: true }]);

    check(
        "write schema rejects a promo entry naming no group",
        !groupless.success,
        groupless.success ? "wrongly accepted" : "rejected",
    );

    // A groupId on a section that renders no group must be rejected.
    const misplaced = homeConfigSchema.safeParse([
        { key: "HERO", enabled: true, groupId: A },
    ]);

    check(
        "write schema rejects groupId on a non-promo section",
        !misplaced.success,
        misplaced.success ? "wrongly accepted" : "rejected",
    );
};

const layoutChecks = () => {
    console.log("\n-- layout resolution --");

    check(
        "position 0 is THREE",
        PROMO_BANNER_LAYOUTS[0] === "THREE",
        `got ${PROMO_BANNER_LAYOUTS[0]} — reordering this tuple restyles every store that never opened the control`,
    );

    check(
        "unknown layout resolves to the default",
        resolvePromoBannerLayout("SEVEN_ACROSS") === "THREE" &&
            resolvePromoBannerLayout(undefined) === "THREE" &&
            resolvePromoBannerLayout(null) === "THREE",
        "an unrecognised or absent value reads back as THREE",
    );

    check(
        "a known layout passes through",
        resolvePromoBannerLayout("ONE") === "ONE",
        "ONE stays ONE",
    );
};

const databaseChecks = async () => {
    console.log("\n-- database round trip --");

    const group = await PromoBannerGroupService.createPromoBannerGroup(undefined, {
        name: `${PREFIX}_strip`,
        layout: "TWO",
    });

    const banner = await BannerService.createBanner({
        placement: "MID",
        type: "IMAGE",
        image: "https://example.test/__verify_promo.png",
        status: "ACTIVE",
        promoBannerGroupId: group.id,
    });

    check(
        "banner assigned to the group",
        banner.promoBannerGroupId === group.id,
        `got ${banner.promoBannerGroupId}`,
    );

    // A non-MID banner cannot join a group.
    let refusedNonMid = false;
    try {
        await BannerService.createBanner({
            placement: "HERO_SIDE",
            type: "IMAGE",
            image: "https://example.test/__verify_promo_hero.png",
            promoBannerGroupId: group.id,
        });
    } catch {
        refusedNonMid = true;
    }

    check(
        "non-MID banner refused a group",
        refusedNonMid,
        "the hero placements are owned by the Home Slider manager",
    );

    // A group that does not exist is refused rather than surfacing as a raw FK error.
    let refusedUnknownGroup = false;
    try {
        await BannerService.updateBanner(banner.id, {
            promoBannerGroupId: "00000000-0000-0000-0000-000000000000",
        });
    } catch {
        refusedUnknownGroup = true;
    }

    check("unknown group refused", refusedUnknownGroup, "404 rather than a foreign-key error");

    /*
     * THE DETACH. Deleting the group must leave the banner on file with no
     * group — a merchant deleting a strip is removing an arrangement, not
     * discarding artwork.
     */
    await PromoBannerGroupService.deletePromoBannerGroup(undefined, group.id);

    const afterDelete = await prisma.banner.findUnique({ where: { id: banner.id } });

    check(
        "deleting a group detaches its banners, does not delete them",
        afterDelete !== null && afterDelete.promoBannerGroupId === null,
        afterDelete === null
            ? "the banner was DELETED — onDelete is not SetNull"
            : `banner survives with groupId=${afterDelete.promoBannerGroupId}`,
    );
};

const main = async () => {
    try {
        reconcileChecks();
        roundTripCheck();
        layoutChecks();
        await databaseChecks();
    } finally {
        // Prefix-scoped so a failed run midway still leaves nothing behind.
        await prisma.banner.deleteMany({
            where: { image: { contains: "__verify_promo" } },
        });
        await prisma.promoBannerGroup.deleteMany({
            where: { name: { startsWith: PREFIX } },
        });
        await prisma.$disconnect();
    }

    console.log(
        failures === 0
            ? "\nAll promo banner group checks passed."
            : `\n${failures} check(s) FAILED.`,
    );

    process.exit(failures === 0 ? 0 : 1);
};

await main();
