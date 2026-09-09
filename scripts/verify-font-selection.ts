/**
 * Verification for font SELECTION: how a library font becomes the typeface a
 * surface renders in, and what stops a selection going stale.
 *
 * Where verify-font-library.ts covers what may enter the library, this covers
 * the consequences of the selection being DENORMALISED — the theme stores a
 * `{ family, url }` copy of a `Font` row rather than a foreign key
 * (design.md Decision 2). That choice keeps the storefront read path untouched,
 * and every property below is part of the price paid for it:
 *
 *  - selecting by family resolves to the library row's real URL, and an unknown
 *    family is refused rather than stored — a stored name with no stylesheet
 *    would render as the fallback with nothing saying why,
 *  - editing a selected font's embed PROPAGATES, or a merchant who adds a
 *    weight to their chosen font would see nothing change,
 *  - deleting a selected font is refused and names the surface, because the
 *    delete is the one operation that could leave a surface pointing at a row
 *    that no longer exists,
 *  - reassign-then-delete works, which is the escape hatch that refusal implies,
 *  - the storefront and admin selections are independent, and
 *  - a theme stored before `adminFont` existed still resolves one on read.
 *
 * Mutates the singleton StoreSetting, so it snapshots the stored theme up front
 * and restores it in the `finally` whether or not the assertions pass. Font
 * rows it creates are `Zzverify`-prefixed (see verify-font-library.ts for why
 * not `__verify_`) and removed the same way.
 *
 * Run with: npx tsx scripts/verify-font-selection.ts
 */
import { prisma } from "../src/app/lib/prisma";
import { FontService } from "../src/app/module/font/font.service";
import { DEFAULT_THEME } from "../src/app/module/store-setting/store-setting.constant";
import { StoreSettingService } from "../src/app/module/store-setting/store-setting.service";

const PREFIX = "Zzverify";
const SINGLETON = "singleton";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

/** The theme as stored right now, without the public read's defaulting. */
const storedTheme = async () => {
    const row = await prisma.storeSetting.findUnique({
        where: { id: SINGLETON },
        select: { theme: true },
    });
    return row?.theme as Record<string, { family?: string; url?: string }> | null;
};

/**
 * Saves a theme selecting the given families.
 *
 * Goes through the service, not a raw update, because resolving `{ family }` to
 * `{ family, url }` is exactly what is under test.
 */
const select = async (font: string, adminFont?: string) =>
    StoreSettingService.updateStoreSetting(undefined as unknown as string, {
        theme: {
            ...DEFAULT_THEME,
            font: { family: font },
            ...(adminFont ? { adminFont: { family: adminFont } } : {}),
        },
    } as never);

const main = async () => {
    const snapshot = await storedTheme();
    const created: string[] = [];

    try {
        // Two library fonts of our own, so the assertions never depend on which
        // starter fonts a given database happens to have.
        const chosen = await FontService.createFont(undefined, {
            embed: `https://fonts.googleapis.com/css2?family=${PREFIX}Chosen:wght@400&display=swap`,
        });
        created.push(chosen.id);

        const other = await FontService.createFont(undefined, {
            embed: `https://fonts.googleapis.com/css2?family=${PREFIX}Other:wght@400&display=swap`,
        });
        created.push(other.id);

        // --- Selecting resolves to the library row's URL ---

        await select(chosen.family, other.family);
        const afterSelect = await storedTheme();
        check(
            "selecting by family stores the library row's URL",
            afterSelect?.font?.family === chosen.family && afterSelect?.font?.url === chosen.url,
            JSON.stringify(afterSelect?.font),
        );
        check(
            "the admin font is selected independently",
            afterSelect?.adminFont?.family === other.family &&
                afterSelect?.adminFont?.url === other.url,
            JSON.stringify(afterSelect?.adminFont),
        );
        check(
            "the two selections differ",
            afterSelect?.font?.family !== afterSelect?.adminFont?.family,
            `${afterSelect?.font?.family} vs ${afterSelect?.adminFont?.family}`,
        );

        // --- An unknown family is refused, and changes nothing ---

        let refusedMessage = "";
        try {
            await select(`${PREFIX}DoesNotExist`);
        } catch (error) {
            refusedMessage = error instanceof Error ? error.message : String(error);
        }
        check(
            "selecting a font that is not in the library is refused",
            refusedMessage.includes("not in the font library"),
            refusedMessage || "it was accepted",
        );

        const afterRefusal = await storedTheme();
        check(
            "the refusal left both selections untouched",
            afterRefusal?.font?.family === chosen.family &&
                afterRefusal?.adminFont?.family === other.family,
            JSON.stringify({ font: afterRefusal?.font?.family, admin: afterRefusal?.adminFont?.family }),
        );

        // --- Editing a selected font propagates ---

        const editedUrl = `https://fonts.googleapis.com/css2?family=${PREFIX}Chosen:wght@100..900&display=swap`;
        await FontService.updateFont(undefined, chosen.id, { embed: editedUrl });

        const afterEdit = await storedTheme();
        check(
            "editing a selected font's embed updates the stored selection",
            afterEdit?.font?.url === editedUrl,
            `${afterEdit?.font?.url}`,
        );
        check(
            "editing one font left the other surface alone",
            afterEdit?.adminFont?.url === other.url,
            `${afterEdit?.adminFont?.url}`,
        );

        // A rename propagates the family too, or the selection would dangle.
        const renamed = await FontService.updateFont(undefined, other.id, {
            embed: `https://fonts.googleapis.com/css2?family=${PREFIX}Renamed:wght@400&display=swap`,
        });
        const afterRename = await storedTheme();
        check(
            "renaming a selected font rewrites the selection's family",
            afterRename?.adminFont?.family === renamed.family,
            `${afterRename?.adminFont?.family}`,
        );

        // --- Deleting a selected font is refused, and names the surface ---

        let storefrontRefusal = "";
        try {
            await FontService.deleteFont(undefined, chosen.id);
        } catch (error) {
            storefrontRefusal = error instanceof Error ? error.message : String(error);
        }
        check(
            "deleting the storefront's font is refused",
            storefrontRefusal.includes("in use") && storefrontRefusal.includes("storefront"),
            storefrontRefusal || "it was deleted",
        );

        let adminRefusal = "";
        try {
            await FontService.deleteFont(undefined, other.id);
        } catch (error) {
            adminRefusal = error instanceof Error ? error.message : String(error);
        }
        check(
            "deleting the admin panel's font is refused and names that surface",
            adminRefusal.includes("admin panel"),
            adminRefusal || "it was deleted",
        );

        // Selected by BOTH surfaces: the refusal must name both.
        await select(chosen.family, chosen.family);
        let bothRefusal = "";
        try {
            await FontService.deleteFont(undefined, chosen.id);
        } catch (error) {
            bothRefusal = error instanceof Error ? error.message : String(error);
        }
        check(
            "a font used by both surfaces names both in the refusal",
            bothRefusal.includes("storefront") && bothRefusal.includes("admin panel"),
            bothRefusal || "it was deleted",
        );

        // --- Reassign, then delete: the escape hatch ---

        await select(renamed.family, renamed.family);
        await FontService.deleteFont(undefined, chosen.id);
        created.splice(created.indexOf(chosen.id), 1);

        const goneRow = await prisma.font.findUnique({ where: { id: chosen.id } });
        check("after reassigning, the font deletes", goneRow === null, "row is gone");

        const afterDelete = await storedTheme();
        check(
            "no surface is left pointing at the deleted font",
            afterDelete?.font?.family === renamed.family &&
                afterDelete?.adminFont?.family === renamed.family,
            JSON.stringify({ font: afterDelete?.font?.family, admin: afterDelete?.adminFont?.family }),
        );

        // --- A theme predating adminFont still resolves one on read ---

        await prisma.storeSetting.update({
            where: { id: SINGLETON },
            data: {
                theme: {
                    ...DEFAULT_THEME,
                    font: { family: renamed.family, url: renamed.url },
                    adminFont: undefined,
                } as never,
            },
        });

        const legacyStored = await storedTheme();
        check(
            "precondition: the stored theme really has no adminFont",
            legacyStored?.adminFont === undefined,
            JSON.stringify(legacyStored?.adminFont),
        );

        const published = await StoreSettingService.getPublicStoreSetting();
        const publishedTheme = published.theme as Record<string, { family?: string; url?: string }>;
        check(
            "a theme without adminFont still publishes one",
            publishedTheme.adminFont?.family === DEFAULT_THEME.adminFont.family &&
                !!publishedTheme.adminFont?.url,
            JSON.stringify(publishedTheme.adminFont),
        );
        check(
            "the storefront font is published untouched alongside it",
            publishedTheme.font?.family === renamed.family,
            JSON.stringify(publishedTheme.font),
        );

        // A half-written font is repaired per key rather than served incomplete.
        await prisma.storeSetting.update({
            where: { id: SINGLETON },
            data: { theme: { ...DEFAULT_THEME, font: { family: "Outfit" } } as never },
        });
        const repaired = (await StoreSettingService.getPublicStoreSetting()).theme as Record<
            string,
            { family?: string; url?: string }
        >;
        check(
            "a font stored without its url is repaired from the default",
            !!repaired.font?.url,
            JSON.stringify(repaired.font),
        );
    } finally {
        // Restore the merchant's real theme before anything else.
        await prisma.storeSetting.update({
            where: { id: SINGLETON },
            data: { theme: (snapshot ?? DEFAULT_THEME) as never },
        });

        await prisma.font.deleteMany({ where: { family: { startsWith: PREFIX } } });
        await prisma.$disconnect();
    }

    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
    if (failures > 0) process.exitCode = 1;
};

main();
