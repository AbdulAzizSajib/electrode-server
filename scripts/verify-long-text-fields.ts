/**
 * Long merchant copy survives a write and a read, byte for byte.
 *
 * ── The failure this exists to catch ──────────────────────────────────────
 *
 * PostgreSQL maps Prisma's `String` to unbounded TEXT. MySQL maps it to
 * VARCHAR(191). Nothing in the schema says 191 anywhere, nothing warns at
 * migrate time, and nothing fails until a merchant pastes a product
 * description into the admin and the save comes back
 * `Data too long for column`. Every field that can legitimately exceed 191
 * characters therefore carries an explicit `@db.Text` or `@db.VarChar(n)`,
 * chosen in the audit recorded at
 * `openspec/changes/switch-database-to-mysql/string-field-audit.tsv`.
 *
 * This script is the assertion behind that audit. It writes a value longer than
 * 191 characters to each annotated field and reads it back, so a field that was
 * missed — or silently reverted to the default in a later edit — fails here
 * rather than in front of a merchant. It covers the catalog spec's "A long
 * description round-trips intact".
 *
 * Every row it creates is `__vlong_`-prefixed and deleted in the finally.
 * Run with: npx tsx scripts/verify-long-text-fields.ts
 */
import { ProductStatus } from "../src/generated/prisma/client";
import { prisma } from "../src/app/lib/prisma";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

const MARKER = "__vlong_";

/**
 * 2,000 characters — the largest ceiling any zod schema in this repo states,
 * and an order of magnitude past VARCHAR(191). Built from a repeated sentence
 * rather than one character so a truncation in the middle is visible in the
 * diff, and given a distinct tail so a silent right-truncation cannot pass.
 */
const LONG = (`${"A merchant writes at length about the product. "}`.repeat(45) + "END").slice(0, 2000);

/** Mixed script, to prove the length limit is counted in characters not bytes. */
const LONG_BANGLA = ("এই পণ্যটি সম্পর্কে বিস্তারিত বিবরণ। ".repeat(60) + "শেষ").slice(0, 1500);

const intact = (written: string, read: string | null | undefined) => read === written;

const main = async () => {
    const category = await prisma.category.findFirst({ select: { id: true } });
    if (!category) throw new Error("Needs a category to attach a probe product to");

    try {
        /* ---- Product.description / shortDescription / seoDescription ---- */
        const product = await prisma.product.create({
            data: {
                name: `${MARKER}Long Copy Probe`,
                slug: `${MARKER}long-copy-probe`,
                categoryId: category.id,
                status: ProductStatus.ACTIVE,
                offerPrice: 100,
                description: LONG,
                shortDescription: LONG_BANGLA,
                seoDescription: LONG,
            },
        });

        const readBack = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });

        check(
            "Product.description holds 2,000 characters intact",
            intact(LONG, readBack.description),
            `${readBack.description?.length ?? 0} of ${LONG.length} characters`,
        );
        check(
            "Product.shortDescription holds 1,500 Bangla characters intact",
            intact(LONG_BANGLA, readBack.shortDescription),
            `${readBack.shortDescription?.length ?? 0} of ${LONG_BANGLA.length} characters`,
        );
        check(
            "Product.seoDescription holds 2,000 characters intact",
            intact(LONG, readBack.seoDescription),
            `${readBack.seoDescription?.length ?? 0} of ${LONG.length} characters`,
        );

        /* ---- Brand.description ---- */
        const brand = await prisma.brand.create({
            data: {
                name: `${MARKER}Long Brand`,
                slug: `${MARKER}long-brand`,
                description: LONG,
            },
        });
        const brandBack = await prisma.brand.findUniqueOrThrow({ where: { id: brand.id } });
        check(
            "Brand.description holds 2,000 characters intact",
            intact(LONG, brandBack.description),
            `${brandBack.description?.length ?? 0} of ${LONG.length} characters`,
        );

        /* ---- Category.description / seoDescription ---- */
        const cat = await prisma.category.create({
            data: {
                name: `${MARKER}Long Category`,
                slug: `${MARKER}long-category`,
                description: LONG,
                seoDescription: LONG,
            },
        });
        const catBack = await prisma.category.findUniqueOrThrow({ where: { id: cat.id } });
        check(
            "Category.description holds 2,000 characters intact",
            intact(LONG, catBack.description),
            `${catBack.description?.length ?? 0} of ${LONG.length} characters`,
        );
        check(
            "Category.seoDescription holds 2,000 characters intact",
            intact(LONG, catBack.seoDescription),
            `${catBack.seoDescription?.length ?? 0} of ${LONG.length} characters`,
        );

        /* ---- URL fields: VarChar(512), not Text ---- */
        /*
         * Cloudinary URLs with a long transformation chain run past 191
         * characters routinely. 400 is comfortably inside the 512 these columns
         * were given and comfortably outside the default.
         */
        const longUrl = `https://res.cloudinary.com/demo/image/upload/${"w_800,h_600,c_fill,q_auto,f_auto/".repeat(9)}${MARKER}.jpg`.slice(0, 400);
        const image = await prisma.productImage.create({
            data: { productId: product.id, url: longUrl, altText: LONG.slice(0, 400) },
        });
        const imageBack = await prisma.productImage.findUniqueOrThrow({ where: { id: image.id } });
        check(
            "ProductImage.url holds a 400-character URL intact",
            intact(longUrl, imageBack.url),
            `${imageBack.url.length} of ${longUrl.length} characters`,
        );

        /* ---- The boundary itself ---- */
        /*
         * The point of the audit is that fields NOT annotated are ones that
         * genuinely cannot exceed 191. This probes just past the boundary on an
         * annotated field, which is where a mistakenly-defaulted column fails
         * and a correctly-annotated one does not.
         */
        const justOver = "x".repeat(192);
        const boundary = await prisma.brand.create({
            data: {
                name: `${MARKER}Boundary`,
                slug: `${MARKER}boundary`,
                description: justOver,
            },
        });
        const boundaryBack = await prisma.brand.findUniqueOrThrow({ where: { id: boundary.id } });
        check(
            "192 characters - one past the VARCHAR(191) default - survives",
            intact(justOver, boundaryBack.description),
            `${boundaryBack.description?.length ?? 0} of 192 characters`,
        );
    } finally {
        await prisma.productImage.deleteMany({
            where: { product: { slug: { startsWith: MARKER } } },
        });
        await prisma.product.deleteMany({ where: { slug: { startsWith: MARKER } } });
        await prisma.brand.deleteMany({ where: { slug: { startsWith: MARKER } } });
        await prisma.category.deleteMany({ where: { slug: { startsWith: MARKER } } });
        await prisma.$disconnect();
    }

    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
    if (failures > 0) process.exitCode = 1;
};

main();
