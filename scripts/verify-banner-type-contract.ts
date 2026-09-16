/**
 * Banner per-type contract verification, for the update path.
 *
 * The contract itself (IMAGE needs artwork and carries no text; DYNAMIC needs a
 * title) is enforced on create by zod and on update by `banner.service.ts`
 * against the payload merged over the stored row — see
 * `openspec/changes/make-banner-fully-dynamic/design.md`, decisions 1 and 2.
 *
 * What this script pins down is the part of that merge that went wrong: judging
 * DYNAMIC-only values the *stored row* carries but the request never mentions.
 * Every banner in the database was an IMAGE row with `buttonText: "Shop Now"`
 * from before the contract existed, so every one of them answered any edit —
 * even swapping the artwork — with `buttonText is only allowed on a DYNAMIC
 * banner`, and the admin hides that input on an IMAGE banner, so there was no
 * way to clear it. Those values are now cleared by the update instead.
 *
 * Creates and deletes its own banners; touches no existing row. Run with:
 *   npx tsx scripts/verify-banner-type-contract.ts
 */
import { prisma } from "../src/app/lib/prisma";
import { BannerService } from "../src/app/module/banner/banner.service";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

/** The message the service raises for a field that belongs to the other type. */
const refusal = async (run: () => Promise<unknown>) => {
    try {
        await run();
        return null;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
};

const main = async () => {
    const created: string[] = [];

    const seed = async (data: Parameters<typeof prisma.banner.create>[0]["data"]) => {
        const banner = await prisma.banner.create({ data });
        created.push(banner.id);
        return banner;
    };

    try {
        // A row shaped like the ones already in the database: IMAGE, with text
        // left over from before the contract.
        const legacy = await seed({
            type: "IMAGE",
            placement: "MID",
            image: "https://example.test/old.png",
            buttonText: "Shop Now",
            status: "DRAFT",
        });

        const swapped = await BannerService.updateBanner(legacy.id, {
            image: "https://example.test/new.png",
        });

        check(
            "artwork swap on a legacy IMAGE banner",
            swapped.image === "https://example.test/new.png",
            `image is ${swapped.image}`,
        );
        check(
            "the stale buttonText is cleared, not reported",
            swapped.buttonText === null,
            `buttonText is ${JSON.stringify(swapped.buttonText)}`,
        );

        // A value the request actually sends is still refused.
        const sent = await seed({
            type: "IMAGE",
            placement: "MID",
            image: "https://example.test/a.png",
            status: "DRAFT",
        });

        const sentMessage = await refusal(() =>
            BannerService.updateBanner(sent.id, { buttonText: "Buy" }),
        );

        check(
            "buttonText sent to an IMAGE banner is still refused",
            sentMessage === "buttonText is only allowed on a DYNAMIC banner",
            sentMessage ?? "the update was accepted",
        );

        // Converting DYNAMIC → IMAGE drops the text the new type cannot render.
        const dynamic = await seed({
            type: "DYNAMIC",
            placement: "MID",
            title: "Eid Sale",
            buttonText: "Shop Now",
            bgColor: "#101010",
            status: "DRAFT",
        });

        const converted = await BannerService.updateBanner(dynamic.id, {
            type: "IMAGE",
            image: "https://example.test/art.png",
        });

        check(
            "DYNAMIC converts to IMAGE",
            converted.type === "IMAGE",
            `type is ${converted.type}`,
        );
        check(
            "conversion clears every DYNAMIC-only field",
            converted.title === null &&
                converted.buttonText === null &&
                converted.bgColor === null,
            `title=${JSON.stringify(converted.title)} buttonText=${JSON.stringify(
                converted.buttonText,
            )} bgColor=${JSON.stringify(converted.bgColor)}`,
        );

        // The guarantee decision 2 exists for is untouched: a DYNAMIC banner
        // still cannot be left without the title it renders.
        const keeper = await seed({
            type: "DYNAMIC",
            placement: "MID",
            title: "Keep me",
            status: "DRAFT",
        });

        const missingImage = await refusal(() =>
            BannerService.updateBanner(keeper.id, { type: "IMAGE" }),
        );

        check(
            "converting to IMAGE without artwork is still refused",
            missingImage === "image is required for an IMAGE banner",
            missingImage ?? "the update was accepted",
        );
    } finally {
        await prisma.banner.deleteMany({ where: { id: { in: created } } });
    }

    console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}\n`);

    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
};

void main();
