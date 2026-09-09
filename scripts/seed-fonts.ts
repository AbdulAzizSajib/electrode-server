/**
 * Populates the font library with the starter faces.
 *
 * Run with:  npx tsx scripts/seed-fonts.ts
 *
 * This exists because `seedSuperAdmin()` — which calls `seedFonts()` — runs
 * from `server.ts`, and `server.ts` is the LOCAL entry point. Vercel imports
 * `api.ts`, which exports the app without ever listening, so no boot-time seed
 * of any kind executes there. Without this script a deployed shop would open
 * its font pickers on an empty library.
 *
 * Safe to run repeatedly. `seedFonts()` populates only when the table is empty,
 * so a merchant who has deleted starter fonts they did not want will not find
 * them reinstated by running this again.
 */
import { prisma } from "../src/app/lib/prisma";
import { seedFonts } from "../src/app/utils/seed";

const main = async () => {
    try {
        const result = await seedFonts();

        if (result.skipped) {
            const count = await prisma.font.count();
            console.log(
                `Font library already has ${count} font(s) — left untouched. ` +
                    `Delete every row first if you want the starter set back.`,
            );
        } else {
            console.log(`Seeded ${result.seeded} starter font(s).`);
        }

        const fonts = await prisma.font.findMany({
            orderBy: { family: "asc" },
            select: { family: true },
        });
        console.log(`Library: ${fonts.map((f) => f.family).join(", ")}`);
    } catch (error) {
        console.error("Failed to seed fonts:", error);
        process.exitCode = 1;
    } finally {
        await prisma.$disconnect();
    }
};

main();
