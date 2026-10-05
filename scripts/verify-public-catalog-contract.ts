/**
 * The public product listing's contract after improve-site-performance: what
 * its search matches, how large a page can be, and what a row carries.
 *
 * Asserts the scenarios in
 * `openspec/changes/improve-site-performance/specs/api/catalog/spec.md`
 * (archived into `openspec/specs/api/catalog/spec.md`). The `limit` clamp lives
 * in `publicProductQueryZodSchema`, which the controller applies before the
 * service, so the query goes through that schema here exactly as it does on
 * the wire.
 *
 * Creates `__vcatalog_`-prefixed products and a brand, deletes them in the
 * finally. Run with: npx tsx scripts/verify-public-catalog-contract.ts
 */
import { ProductStatus } from "../src/generated/prisma/client";
import { prisma } from "../src/app/lib/prisma";
import { IQueryParams } from "../src/app/interfaces/query.interface";
import { ProductService } from "../src/app/module/product/product.service";
import {
    PUBLIC_PRODUCT_PAGE_SIZE_MAX,
    publicProductQueryZodSchema,
} from "../src/app/module/product/product.validation";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

const MARKER = "__vcatalog_";

/** The listing as the controller runs it: query string → schema → service. */
const list = (query: Record<string, string>) =>
    ProductService.getPublicProducts(
        publicProductQueryZodSchema.parse(query) as IQueryParams & { isFeatured?: boolean },
    );

const main = async () => {
    const category = await prisma.category.findFirst({ select: { id: true } });
    if (!category) throw new Error("Needs a category to attach probe products to");

    try {
        const brand = await prisma.brand.create({
            data: { name: `${MARKER}Probe Brand`, slug: `${MARKER}probe-brand` },
        });

        const base = {
            categoryId: category.id,
            brandId: brand.id,
            status: ProductStatus.ACTIVE,
            offerPrice: 100,
        };

        const [byName, bySku, byDescription] = await Promise.all([
            prisma.product.create({
                data: { ...base, slug: `${MARKER}name`, name: `${MARKER}Zyxqv Earbuds` },
            }),
            prisma.product.create({
                data: { ...base, slug: `${MARKER}sku`, name: `${MARKER}Plain Speaker`, sku: "ZYXQV-SKU-1" },
            }),
            prisma.product.create({
                data: {
                    ...base,
                    slug: `${MARKER}description`,
                    name: `${MARKER}Plain Charger`,
                    description: "<p>Works with every zyxqv device</p>",
                    shortDescription: "zyxqv compatible",
                },
            }),
        ]);

        // ── Search matches name and SKU, not description ─────────────────────
        const found = (await list({ searchTerm: "ZYXQV", limit: "60" })).data.map((p) => p.id);
        check("search matches a name, any letter case", found.includes(byName.id), `${found.length} result(s)`);
        check("search matches a SKU", found.includes(bySku.id), `${found.length} result(s)`);
        check(
            "search does not match description-only text",
            !found.includes(byDescription.id),
            found.includes(byDescription.id) ? "description-only product returned" : "not returned",
        );

        // ── Oversized page request is clamped ───────────────────────────────
        const big = await list({ limit: "1000" });
        check(
            `limit=1000 returns at most ${PUBLIC_PRODUCT_PAGE_SIZE_MAX} rows`,
            big.data.length <= PUBLIC_PRODUCT_PAGE_SIZE_MAX,
            `${big.data.length} row(s)`,
        );
        check(
            `meta.limit reports ${PUBLIC_PRODUCT_PAGE_SIZE_MAX}`,
            big.meta.limit === PUBLIC_PRODUCT_PAGE_SIZE_MAX,
            `meta.limit = ${big.meta.limit}`,
        );
        const junk = await list({ limit: "abc" });
        check("a non-numeric limit falls back to the default", junk.meta.limit === 10, `meta.limit = ${junk.meta.limit}`);

        // ── List rows omit the long description, refs are narrowed ──────────
        const row = (await list({ searchTerm: `${MARKER}Zyxqv` })).data.find((p) => p.id === byName.id) as
            | Record<string, unknown>
            | undefined;
        check("probe row is listed", Boolean(row), row ? "found" : "missing");
        if (row) {
            check("list row has no description", !("description" in row), Object.keys(row).length + " keys");
            const keysOf = (value: unknown) => Object.keys((value ?? {}) as object).sort().join(",");
            check("list row category is id,name,slug", keysOf(row.category) === "id,name,slug", keysOf(row.category));
            check("list row brand is id,name,slug", keysOf(row.brand) === "id,name,slug", keysOf(row.brand));
        }

        // ── Detail still carries the description ────────────────────────────
        const detail = (await ProductService.getPublicProductBySlug(byDescription.slug)) as Record<string, unknown>;
        check(
            "detail carries description",
            typeof detail.description === "string" && detail.description.includes("zyxqv"),
            typeof detail.description,
        );
    } finally {
        await prisma.product.deleteMany({ where: { slug: { startsWith: MARKER } } });
        await prisma.brand.deleteMany({ where: { slug: { startsWith: MARKER } } });
        await prisma.$disconnect();
    }

    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
    if (failures > 0) process.exitCode = 1;
};

main();
