/**
 * Search-as-you-type: that it finds exactly what it always found, and that it
 * can use the trigram indexes to find it.
 *
 * `searchProducts` was rewritten so its WHERE clause is index-servable. The old
 * predicates — `lower(col) LIKE '%' || lower(term) || '%'`, ORed across Product
 * and a joined Brand — could not use any index, so every keystroke scanned the
 * whole catalog even with pg_trgm indexes present. The rewrite must not change
 * a single result, so the central assertion here is not "results look right"
 * but "results are IDENTICAL to the old query": same products, same order, for
 * every kind of term — exact, prefix, substring, SKU, brand, description,
 * misspelled, mixed case, LIKE metacharacters and Bangla.
 *
 * The old query is frozen below as the reference. It is deliberately a copy,
 * not an import: it is the behaviour being preserved, and it must not move
 * when the implementation does.
 *
 * The index check runs the implementation's own SQL (captured as it executes)
 * under EXPLAIN with sequential scans disabled. On a catalog this small the
 * planner prefers a scan whatever indexes exist, so disabling it is how to ask
 * "CAN this query use the indexes?" rather than "does it at this size?".
 *
 * Creates `__vsearch_`-prefixed products and a brand, deletes them in the
 * finally. Run with: npx tsx scripts/verify-product-search.ts
 */
import { Prisma, ProductStatus } from "../src/generated/prisma/client";
import { prisma } from "../src/app/lib/prisma";
import { ProductService, SEARCH_RESULT_CAP } from "../src/app/module/product/product.service";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

const MARKER = "__vsearch_";

const w = (value: number) => Prisma.raw(`${value}::numeric`);

/** The search query as it stood before the index-servable rewrite. Frozen. */
const referenceSearch = async (term: string): Promise<string[]> => {
    const trimmed = term.trim();
    if (trimmed.length === 0) return [];

    const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT
            p.id,
            GREATEST(
                CASE
                    WHEN lower(p.name) = lower(${trimmed}) THEN ${w(1.0)}
                    WHEN lower(p.name) LIKE lower(${trimmed}) || '%' THEN ${w(0.9)}
                    WHEN lower(p.name) LIKE '%' || lower(${trimmed}) || '%' THEN ${w(0.8)}
                    ELSE 0::numeric
                END,
                CASE WHEN lower(COALESCE(p.sku, '')) LIKE '%' || lower(${trimmed}) || '%'
                     THEN ${w(0.75)} ELSE 0::numeric END,
                CASE WHEN lower(COALESCE(b.name, '')) LIKE '%' || lower(${trimmed}) || '%'
                     THEN ${w(0.7)} ELSE 0::numeric END,
                CASE WHEN lower(COALESCE(p.description, '')) LIKE '%' || lower(${trimmed}) || '%'
                     THEN ${w(0.5)} ELSE 0::numeric END,
                similarity(p.name, ${trimmed})::numeric * ${w(0.4)},
                similarity(COALESCE(b.name, ''), ${trimmed})::numeric * ${w(0.35)}
            ) AS score,
            p.name
        FROM "Product" p
        LEFT JOIN "Brand" b ON b.id = p."brandId"
        WHERE p.status = ${ProductStatus.ACTIVE}::"ProductStatus"
          AND (
                lower(p.name) LIKE '%' || lower(${trimmed}) || '%'
             OR lower(COALESCE(p.sku, '')) LIKE '%' || lower(${trimmed}) || '%'
             OR lower(COALESCE(b.name, '')) LIKE '%' || lower(${trimmed}) || '%'
             OR lower(COALESCE(p.description, '')) LIKE '%' || lower(${trimmed}) || '%'
             OR p.name % ${trimmed}
             OR COALESCE(b.name, '') % ${trimmed}
          )
        ORDER BY score DESC, p.name ASC
        LIMIT ${SEARCH_RESULT_CAP}
    `;

    return rows.map((row) => row.id);
};

const TERMS = [
    "earbuds",
    "EARBUDS",
    `${MARKER}wireless earbuds pro`,
    `${MARKER}earb`,
    "vs-eb",
    "VS_CASE",
    "acme",
    "Acme Audio",
    "noise cancel",
    "earbds",
    "speakr",
    "চার্জার",
    "দ্রুত",
    "100%",
    "under_score",
    "_",
    "%",
    "mAh",
    "bank",
    "a",
    "zzz-no-such-thing",
];

const main = async () => {
    const category = await prisma.category.findFirst({ select: { id: true } });
    if (!category) throw new Error("Needs a category to attach probe products to");

    try {
        const brand = await prisma.brand.create({
            data: { name: `${MARKER}Acme Audio`, slug: `${MARKER}acme-audio` },
        });

        const product = (
            key: string,
            data: Partial<Prisma.ProductUncheckedCreateInput> & { name: string },
        ) =>
            prisma.product.create({
                data: {
                    slug: `${MARKER}${key}`,
                    categoryId: category.id,
                    status: ProductStatus.ACTIVE,
                    offerPrice: 100,
                    ...data,
                },
            });

        const [, , , , , hiddenProduct] = await Promise.all([
            product("earbuds-pro", {
                name: `${MARKER}Wireless Earbuds Pro`,
                sku: "VS-EB-100",
                brandId: brand.id,
                description: "Noise cancelling earbuds with long battery life",
            }),
            product("earbuds-lite", {
                name: `${MARKER}Earbuds Lite`,
                sku: "VS-EB-050",
                description: "Budget earbuds",
            }),
            product("speaker", {
                name: `${MARKER}Bluetooth Speaker`,
                sku: "VS-SPK-01",
                brandId: brand.id,
                description: "Portable speaker, 20W",
                shortDescription: "Loud and small",
            }),
            product("charger-bn", {
                name: `${MARKER}চার্জার ফাস্ট`,
                sku: "VS-CHG-BN",
                description: "দ্রুত চার্জিং",
            }),
            product("case", {
                name: `${MARKER}100% Cotton Case`,
                sku: "VS_CASE_1",
                description: "case with an under_score",
            }),
            product("inactive", {
                name: `${MARKER}Hidden Earbuds`,
                sku: "VS-EB-999",
                status: ProductStatus.DRAFT,
            }),
            product("bank", {
                name: `${MARKER}Power Bank 10000mAh`,
                brandId: brand.id,
            }),
        ]);

        /* ---------------- identical results, term by term ---------------- */
        for (const term of TERMS) {
            const [reference, actual] = await Promise.all([
                referenceSearch(term),
                ProductService.searchProducts(term).then((rows) => rows.map((row) => row.id)),
            ]);
            const same =
                reference.length === actual.length && reference.every((id, i) => id === actual[i]);
            check(`"${term}" returns what it always did`, same, `${actual.length} result(s)${same ? "" : `, reference had ${reference.length}`}`);
        }

        // Other probes may match on the shared prefix; what matters is that the
        // DRAFT product, an exact name match, is not among them.
        const hidden = await ProductService.searchProducts(`${MARKER}Hidden Earbuds`);
        check(
            "a non-ACTIVE product is never suggested",
            !hidden.some((row) => row.id === hiddenProduct.id),
            `${hidden.length} result(s), draft ${hidden.some((row) => row.id === hiddenProduct.id) ? "present" : "absent"}`,
        );

        /* ---------------- the query can use the indexes ---------------- */
        /*
         * Captured by wrapping `$queryRaw` for one call, then put back EXACTLY
         * as it was — an own property removed rather than overwritten. A
         * leftover own property bound to the base client is inherited by the
         * transaction client below, which then runs its queries OUTSIDE the
         * transaction, where `SET LOCAL` does not apply.
         */
        let captured: Prisma.Sql | null = null;
        const client = prisma as unknown as Record<string, unknown>;
        const hadOwn = Object.prototype.hasOwnProperty.call(client, "$queryRaw");
        const original = client.$queryRaw as (...args: unknown[]) => unknown;
        client.$queryRaw = (strings: unknown, ...values: unknown[]) => {
            captured = Prisma.sql(strings as TemplateStringsArray, ...values);
            return original.call(prisma, strings, ...values);
        };
        try {
            await ProductService.searchProducts("earbuds");
        } finally {
            if (hadOwn) client.$queryRaw = original;
            else delete client.$queryRaw;
        }

        if (!captured) {
            check("the search SQL was captured for EXPLAIN", false, "no $queryRaw call observed");
        } else {
            const sql: Prisma.Sql = captured;
            /*
             * Both plain scans off, bitmap scans left on. With only
             * `enable_seqscan` off the planner walks the primary-key index end
             * to end and filters — a full scan under another name — so the
             * question "can it use the trigram indexes?" needs that door
             * closed too.
             */
            const plan = await prisma.$transaction(async (tx) => {
                await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
                await tx.$executeRawUnsafe("SET LOCAL enable_indexscan = off");
                const rows = await tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
                    `EXPLAIN ${sql.text}`,
                    ...sql.values,
                );
                return rows.map((row) => row["QUERY PLAN"]).join("\n");
            });

            for (const index of [
                "Product_name_trgm_idx",
                "Product_sku_trgm_idx",
                "Product_description_trgm_idx",
                "Brand_name_trgm_idx",
            ]) {
                check(`search can use ${index}`, plan.includes(index), plan.includes(index) ? "in the plan" : "absent from the plan");
            }
            if (process.env.PLAN) console.log(plan);
        }
    } finally {
        await prisma.product.deleteMany({ where: { slug: { startsWith: MARKER } } });
        await prisma.brand.deleteMany({ where: { slug: { startsWith: MARKER } } });
        await prisma.$disconnect();
    }

    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
    if (failures > 0) process.exitCode = 1;
};

main();
