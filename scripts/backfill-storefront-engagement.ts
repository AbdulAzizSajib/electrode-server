/**
 * One-time backfill for the add-storefront-engagement-apis change.
 *
 * Two independent jobs, both idempotent and safe to re-run:
 *
 * 1. Product rating aggregates. `Product.averageRating` / `Product.reviewCount`
 *    were added with a default of 0, so every product that existed before the
 *    migration reads "no reviews" until recomputed from its APPROVED reviews.
 *    Because the recompute is a full re-aggregation (never delta arithmetic),
 *    re-running this doubles as a repair tool if an aggregate ever drifts.
 *
 * 2. StoreSetting storefront defaults. Seeds the singleton's new branding and
 *    JSON columns with values mirroring the storefront's previously-hardcoded
 *    header/footer content, so the site renders identically on first deploy.
 *    Only fills columns that are still NULL — an admin's saved values are
 *    never overwritten.
 *
 * Run:  npx tsx scripts/backfill-storefront-engagement.ts
 */
import { ReviewStatus } from "../src/generated/prisma/enums";
import { prisma } from "../src/app/lib/prisma";
import {
    SINGLETON_ID,
    STOREFRONT_SEED_DEFAULTS,
} from "../src/app/module/store-setting/store-setting.constant";

async function backfillProductRatings() {
    console.log("Recomputing product rating aggregates...");

    // Group once over all approved reviews rather than querying per product:
    // products with no approved reviews simply don't appear and are reset to 0.
    const grouped = await prisma.review.groupBy({
        by: ["productId"],
        where: { status: ReviewStatus.APPROVED },
        _avg: { rating: true },
        _count: true,
    });

    const aggregates = new Map(
        grouped.map((row) => [row.productId, { avg: row._avg.rating ?? 0, count: row._count }]),
    );

    const products = await prisma.product.findMany({
        select: { id: true, averageRating: true, reviewCount: true },
    });

    let updated = 0;
    let unchanged = 0;

    for (const product of products) {
        const aggregate = aggregates.get(product.id) ?? { avg: 0, count: 0 };

        // Decimal comparison via Number: the column is Decimal(3,2) and the
        // aggregate is a float, so compare at the stored precision.
        const currentAverage = Number(product.averageRating);
        const nextAverage = Number(aggregate.avg.toFixed(2));

        if (currentAverage === nextAverage && product.reviewCount === aggregate.count) {
            unchanged++;
            continue;
        }

        await prisma.product.update({
            where: { id: product.id },
            data: { averageRating: aggregate.avg, reviewCount: aggregate.count },
        });
        updated++;
    }

    console.log(`  ✓ ${updated} product(s) updated, ${unchanged} already correct.`);
}

async function seedStoreSettingDefaults() {
    console.log("Seeding StoreSetting storefront defaults...");

    const existing = await prisma.storeSetting.findUnique({ where: { id: SINGLETON_ID } });

    if (!existing) {
        await prisma.storeSetting.create({
            data: { id: SINGLETON_ID, ...STOREFRONT_SEED_DEFAULTS },
        });
        console.log("  ✓ Created the singleton row with storefront defaults.");
        return;
    }

    // Only fill what is still NULL — never clobber an admin's saved values.
    const data = Object.fromEntries(
        Object.entries(STOREFRONT_SEED_DEFAULTS).filter(
            ([key]) => existing[key as keyof typeof existing] == null,
        ),
    );

    if (Object.keys(data).length === 0) {
        console.log("  ✓ Every storefront field is already set; nothing to seed.");
        return;
    }

    await prisma.storeSetting.update({ where: { id: SINGLETON_ID }, data });
    console.log(`  ✓ Seeded ${Object.keys(data).length} previously-unset field(s): ${Object.keys(data).join(", ")}`);
}

async function main() {
    await backfillProductRatings();
    await seedStoreSettingDefaults();
    console.log("\nDone.");
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
