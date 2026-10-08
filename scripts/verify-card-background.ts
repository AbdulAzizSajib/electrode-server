/**
 * Verification for the theme's optional card background colour.
 *
 * The properties under test are the three states and the two ways they break
 * silently:
 *
 *  - a hex is stored; `null` removes it; an OMITTED key keeps it — an older
 *    caller saving the theme without the key must not erase the merchant's
 *    colour (the same contract `adminFont` has);
 *  - a value carrying extra declarations is refused, naming the field;
 *  - the public read has no card colour until one is set — "unset" is a real
 *    state the storefront renders differently per surface, so a default
 *    appearing on read would quietly change every shop.
 *
 * Part A needs no database. Part B round-trips the real singleton and restores
 * its original theme in a `finally`. See
 * openspec/changes/add-card-background-theme-color.
 *
 * Run with:
 *   npx tsx scripts/verify-card-background.ts
 */
import { RoleName } from "../src/app/constants/role.constant";
import { prisma } from "../src/app/lib/prisma";
import { DEFAULT_THEME } from "../src/app/module/store-setting/store-setting.constant";
import { StoreSettingService } from "../src/app/module/store-setting/store-setting.service";
import { themeSchema } from "../src/app/module/store-setting/store-setting.validation";
import type { Prisma } from "../src/generated/prisma/client";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

/** A complete, legal theme payload, as the admin sends it. */
const baseTheme = () => ({ ...DEFAULT_THEME, font: DEFAULT_THEME.font.url, adminFont: undefined });

/**
 * What the service actually receives: the HTTP route runs the theme through
 * `themeSchema` first (validateRequest), which turns the font embed URL into
 * its parsed form. Calling the service with the raw payload would skip that.
 */
const parsedTheme = (extra: Record<string, unknown> = {}) => themeSchema.parse({ ...baseTheme(), ...extra });

const partA = () => {
    console.log("— Part A: validation (no database) —");

    check(
        "a hex card colour is accepted",
        themeSchema.safeParse({ ...baseTheme(), cardBackground: "#fff9f2" }).success,
        "#fff9f2",
    );
    check(
        "null is accepted (clear)",
        themeSchema.safeParse({ ...baseTheme(), cardBackground: null }).success,
        "null",
    );
    check(
        "omitting the key is accepted (keep)",
        themeSchema.safeParse(baseTheme()).success,
        "no cardBackground key",
    );

    const injected = themeSchema.safeParse({ ...baseTheme(), cardBackground: "red; color: x" });
    const names = !injected.success && injected.error.issues.some((i) => i.path.includes("cardBackground"));
    check(
        "a value carrying extra declarations is refused, naming the field",
        !injected.success && names,
        injected.success ? "ACCEPTED" : `refused at ${injected.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
};

const storedCard = async () => {
    const row = await prisma.storeSetting.findUnique({ where: { id: "singleton" }, select: { theme: true } });
    return (row?.theme as { cardBackground?: unknown } | null)?.cardBackground;
};

const partB = async () => {
    console.log("— Part B: round trip through the real singleton —");

    try {
        await prisma.$queryRaw`SELECT 1`;
    } catch {
        console.log("SKIP  database unreachable from here — Part B not run");
        return;
    }

    const owner = await prisma.user.findFirst({
        where: { role: { name: RoleName.OWNER } },
        select: { id: true },
    });
    if (!owner) {
        console.log("SKIP  no OWNER user to attribute the saves to — Part B not run");
        return;
    }

    const original = await prisma.storeSetting.findUnique({
        where: { id: "singleton" },
        select: { theme: true },
    });

    try {
        await StoreSettingService.updateStoreSetting(owner.id, {
            theme: parsedTheme({ cardBackground: "#fff9f2" }),
        } as never);
        const set = await storedCard();
        check("a hex is stored", set === "#fff9f2", `stored ${JSON.stringify(set)}`);

        await StoreSettingService.updateStoreSetting(owner.id, { theme: parsedTheme() } as never);
        const kept = await storedCard();
        check("a save omitting the key keeps it", kept === "#fff9f2", `stored ${JSON.stringify(kept)}`);

        await StoreSettingService.updateStoreSetting(owner.id, {
            theme: parsedTheme({ cardBackground: null }),
        } as never);
        const cleared = await storedCard();
        check("null removes it", cleared === undefined, `stored ${JSON.stringify(cleared)}`);

        const publicRead = (await StoreSettingService.getPublicStoreSetting()) as {
            theme?: { cardBackground?: unknown };
        };
        check(
            "the public read has no card colour when unset",
            publicRead.theme?.cardBackground === undefined,
            `public ${JSON.stringify(publicRead.theme?.cardBackground)}`,
        );
    } finally {
        await prisma.storeSetting.update({
            where: { id: "singleton" },
            data: { theme: (original?.theme ?? undefined) as Prisma.InputJsonValue | undefined },
        });
    }
};

const main = async () => {
    partA();
    await partB();
    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
};

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
