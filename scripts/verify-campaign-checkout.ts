/**
 * Campaign pricing verification — that what a shopper is SHOWN is what they are
 * CHARGED.
 *
 * This exists because those two answers were, for a while, produced by two
 * different pieces of code. The product endpoints applied a campaign discount
 * and the storefront rendered the cut price; checkout read `offerPrice` and
 * billed the full amount. A shopper saw 800 and paid 1000, and the order
 * recorded 1000 as though that were the agreed price.
 *
 * So the assertions here are deliberately not "does the discount arithmetic
 * work". They are "do the display path and the charging path agree", which is
 * the property that was actually broken and the one that silently breaks again
 * if either side grows its own copy of the calculation.
 *
 * Creates `__verify_`-prefixed products and a campaign, and deletes them in the
 * `finally`. Run with:
 *   npx tsx scripts/verify-campaign-checkout.ts
 */
import { CampaignStatus, DiscountType, ProductStatus } from "../src/generated/prisma/client";
import { prisma } from "../src/app/lib/prisma";
import { CampaignService } from "../src/app/module/campaign/campaign.service";
import { ProductService } from "../src/app/module/product/product.service";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

const PREFIX = "__verify_campaign_";

const main = async () => {
    // Any category/brand will do — this is about price, not classification.
    const category = await prisma.category.findFirst({ select: { id: true } });
    if (!category) {
        console.log("No category exists; cannot create a probe product. Skipping.");
        return;
    }

    const created: { productIds: string[]; campaignIds: string[]; variantIds: string[] } = {
        productIds: [],
        campaignIds: [],
        variantIds: [],
    };

    try {
        /* ------------------------------------------------------------------ *
         * Fixtures: a plain product, and one with two differently-priced
         * variants — the case where "apply the discount" is ambiguous.
         * ------------------------------------------------------------------ */
        const plain = await prisma.product.create({
            data: {
                name: `${PREFIX}plain`,
                slug: `${PREFIX}plain`,
                sku: `${PREFIX}PLAIN`,
                categoryId: category.id,
                status: ProductStatus.ACTIVE,
                offerPrice: 1000,
                sellingPrice: 1200,
            },
            select: { id: true },
        });
        created.productIds.push(plain.id);

        const varied = await prisma.product.create({
            data: {
                name: `${PREFIX}varied`,
                slug: `${PREFIX}varied`,
                sku: `${PREFIX}VARIED`,
                categoryId: category.id,
                status: ProductStatus.ACTIVE,
                offerPrice: 1000,
            },
            select: { id: true },
        });
        created.productIds.push(varied.id);

        const cheapVariant = await prisma.productVariant.create({
            data: {
                productId: varied.id,
                name: `${PREFIX}128gb`,
                sku: `${PREFIX}128`,
                offerPrice: 1000,
            },
            select: { id: true },
        });
        const dearVariant = await prisma.productVariant.create({
            data: {
                productId: varied.id,
                name: `${PREFIX}256gb`,
                sku: `${PREFIX}256`,
                offerPrice: 1500,
            },
            select: { id: true },
        });
        created.variantIds.push(cheapVariant.id, dearVariant.id);

        /* ------------------------------------------------------------------ *
         * 1. No campaign: the charged price is the offer price, untouched.
         *
         * The fix must not change what a product without a campaign costs.
         * ------------------------------------------------------------------ */
        const beforeCampaign = await CampaignService.getActiveDiscountsForLines([
            { productId: plain.id, variantId: null, unitPrice: 1000 },
        ]);
        check(
            "uncampaigned line is left alone",
            beforeCampaign.size === 0,
            `resolver returned ${beforeCampaign.size} priced lines, expected 0`,
        );

        /* ------------------------------------------------------------------ *
         * 2. An active 20% campaign.
         * ------------------------------------------------------------------ */
        const campaign = await prisma.campaign.create({
            data: {
                name: `${PREFIX}20pct`,
                status: CampaignStatus.ACTIVE,
                startsAt: new Date(Date.now() - 60_000),
                endsAt: new Date(Date.now() + 3_600_000),
                products: {
                    create: [
                        {
                            productId: plain.id,
                            discountType: DiscountType.PERCENTAGE,
                            discountValue: 20,
                        },
                        {
                            productId: varied.id,
                            discountType: DiscountType.PERCENTAGE,
                            discountValue: 20,
                        },
                    ],
                },
            },
            select: { id: true },
        });
        created.campaignIds.push(campaign.id);

        /* ------------------------------------------------------------------ *
         * 3. THE CENTRAL ASSERTION — display equals charge.
         *
         * The displayed figure comes from the product read the storefront
         * actually calls; the charged figure from the resolver checkout
         * actually calls. If these ever diverge, the original bug is back.
         * ------------------------------------------------------------------ */
        const shown = await ProductService.getPublicProductBySlug(`${PREFIX}plain`);
        const shownPrice = Number((shown as { campaignPrice: number | null }).campaignPrice);

        const charged = await CampaignService.getActiveDiscountsForLines([
            { productId: plain.id, variantId: null, unitPrice: 1000 },
        ]);
        const chargedPrice = charged.get(`${plain.id}:`);

        check(
            "storefront shows the discounted price",
            near(shownPrice, 800),
            `displayed ${shownPrice}, expected 800`,
        );
        check(
            "checkout charges the discounted price",
            chargedPrice !== undefined && near(chargedPrice, 800),
            `charged ${chargedPrice ?? "(none)"}, expected 800`,
        );
        check(
            "displayed price EQUALS charged price",
            chargedPrice !== undefined && near(shownPrice, chargedPrice),
            `displayed ${shownPrice} vs charged ${chargedPrice ?? "(none)"}`,
        );

        /* ------------------------------------------------------------------ *
         * 4. Variants are discounted off their OWN price.
         *
         * The decision on record: a 20% campaign takes 20% off the 256GB
         * model's own 1500, not 20% of the product's 1000. Every variant gets
         * the same proportional cut.
         * ------------------------------------------------------------------ */
        const variantPrices = await CampaignService.getActiveDiscountsForLines([
            { productId: varied.id, variantId: cheapVariant.id, unitPrice: 1000 },
            { productId: varied.id, variantId: dearVariant.id, unitPrice: 1500 },
        ]);

        const cheapPriced = variantPrices.get(`${varied.id}:${cheapVariant.id}`);
        const dearPriced = variantPrices.get(`${varied.id}:${dearVariant.id}`);

        check(
            "cheap variant discounted off its own price",
            cheapPriced !== undefined && near(cheapPriced, 800),
            `got ${cheapPriced ?? "(none)"}, expected 800 (20% off 1000)`,
        );
        check(
            "dear variant discounted off its own price",
            dearPriced !== undefined && near(dearPriced, 1200),
            `got ${dearPriced ?? "(none)"}, expected 1200 (20% off 1500)`,
        );

        /* ------------------------------------------------------------------ *
         * 5. A FIXED discount larger than the price floors at zero.
         *
         * A negative line would pay the shopper to take the goods.
         * ------------------------------------------------------------------ */
        const floored = CampaignService.applyCampaignDiscount(100, {
            discountType: DiscountType.FIXED,
            discountValue: 500,
        });
        check(
            "over-large fixed discount floors at zero",
            near(floored, 0),
            `got ${floored}, expected 0`,
        );

        /* ------------------------------------------------------------------ *
         * 6. An EXPIRED campaign prices nothing.
         *
         * The window is the whole mechanism by which a sale ends; if checkout
         * ignored it, a finished campaign would discount forever.
         * ------------------------------------------------------------------ */
        await prisma.campaign.update({
            where: { id: campaign.id },
            data: { endsAt: new Date(Date.now() - 1_000) },
        });

        const afterExpiry = await CampaignService.getActiveDiscountsForLines([
            { productId: plain.id, variantId: null, unitPrice: 1000 },
        ]);
        check(
            "expired campaign stops discounting",
            afterExpiry.size === 0,
            `resolver returned ${afterExpiry.size} priced lines, expected 0`,
        );

        /* ------------------------------------------------------------------ *
         * 7. A DRAFT campaign prices nothing either — status matters as much
         *    as the window, and a merchant preparing a sale must not leak it.
         * ------------------------------------------------------------------ */
        await prisma.campaign.update({
            where: { id: campaign.id },
            data: { status: CampaignStatus.DRAFT, endsAt: new Date(Date.now() + 3_600_000) },
        });

        const draftPrices = await CampaignService.getActiveDiscountsForLines([
            { productId: plain.id, variantId: null, unitPrice: 1000 },
        ]);
        check(
            "draft campaign does not discount",
            draftPrices.size === 0,
            `resolver returned ${draftPrices.size} priced lines, expected 0`,
        );
    } finally {
        // Order matters: campaign products and variants hang off these rows.
        await prisma.campaign.deleteMany({ where: { name: { startsWith: PREFIX } } });
        await prisma.productVariant.deleteMany({ where: { name: { startsWith: PREFIX } } });
        await prisma.product.deleteMany({ where: { name: { startsWith: PREFIX } } });
    }
};

main()
    .then(() => {
        console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
        process.exit(failures === 0 ? 0 : 1);
    })
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
