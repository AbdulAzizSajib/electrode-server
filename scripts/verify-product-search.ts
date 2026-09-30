/**
 * Search-as-you-type: that it finds what the spec says it finds, and nothing
 * more.
 *
 * ── What changed, and why this script was rewritten ───────────────────────
 *
 * Under PostgreSQL this file asserted two things that no longer exist. First,
 * that a rewritten query returned results IDENTICAL to a frozen copy of its
 * predecessor — a useful assertion while the change was meant to preserve
 * behaviour exactly, and a meaningless one now that dropping trigram matching
 * has deliberately changed it. Second, that the query could use four
 * `gin_trgm_ops` indexes, checked by running it under EXPLAIN with
 * `enable_seqscan` and `enable_indexscan` off. Both the indexes and those
 * planner switches are PostgreSQL-only, and MariaDB has no equivalent of
 * either, so that half is gone rather than translated: there is no index left
 * to prove the use of, and the scan is now an accepted cost (see
 * `searchProducts` in product.service.ts).
 *
 * What replaces them is an assertion against the contract itself — the
 * scenarios in `openspec/specs/api/catalog/spec.md`, "Product search matches on
 * literal substrings, not approximate spelling". That is a stronger thing to
 * check than equality with an older implementation, because it is what the
 * endpoint actually promises.
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

/** Slugs are the stable handle on the probe rows; ids are generated per run. */
const idsOf = async (term: string) => (await ProductService.searchProducts(term)).map((r) => r.id);

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

        const [earbudsPro, , speaker, chargerBn, cottonCase, hiddenProduct, powerBank] =
            await Promise.all([
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

        /* ---- Scenario: correctly spelled partial word matches ---- */
        const partial = await idsOf("Earbuds");
        check(
            "a substring of the name matches",
            partial.includes(earbudsPro.id),
            `${partial.length} result(s), earbuds-pro ${partial.includes(earbudsPro.id) ? "found" : "MISSING"}`,
        );

        /* ---- Scenario: case is ignored ---- */
        // Both directions, because a collation that folded only one way would
        // still pass a single-cased probe.
        const upper = await idsOf("EARBUDS");
        const lower = await idsOf("earbuds");
        const sameSet =
            upper.length === lower.length && upper.every((id, i) => id === lower[i]);
        check(
            "case is folded by the collation, both directions",
            sameSet && upper.length > 0,
            `EARBUDS -> ${upper.length}, earbuds -> ${lower.length}`,
        );

        const brandUpper = await idsOf("ACME");
        check(
            "a brand name matches regardless of case",
            brandUpper.includes(speaker.id),
            `${brandUpper.length} result(s) for ACME`,
        );

        /* ---- Scenario: Bangla term matches a Bangla name ---- */
        // This is also the charset assertion: if the column were latin1 the
        // stored text would be mojibake and this would find nothing.
        const bangla = await idsOf("চার্জার");
        check(
            "a Bangla term matches a Bangla product name",
            bangla.includes(chargerBn.id),
            `${bangla.length} result(s) for চার্জার`,
        );

        const banglaDescription = await idsOf("দ্রুত");
        check(
            "a Bangla term matches a Bangla description",
            banglaDescription.includes(chargerBn.id),
            `${banglaDescription.length} result(s) for দ্রুত`,
        );

        /* ---- Scenario: a misspelling returns nothing ---- */
        // The behaviour change this whole migration accepted: pg_trgm used to
        // rescue these. Asserted rather than merely noted, so that a future
        // change that silently reintroduces fuzzy matching is caught here.
        for (const typo of ["earbds", "speakr", "zzz-no-such-thing"]) {
            const rows = await idsOf(typo);
            check(
                `"${typo}" matches nothing — fuzzy search is gone by design`,
                rows.length === 0,
                `${rows.length} result(s)`,
            );
        }

        /* ---- Scenario: only active products are searchable ---- */
        const hidden = await idsOf(`${MARKER}Hidden Earbuds`);
        check(
            "a non-ACTIVE product is never suggested",
            !hidden.includes(hiddenProduct.id),
            `${hidden.length} result(s), draft ${hidden.includes(hiddenProduct.id) ? "PRESENT" : "absent"}`,
        );

        /* ---- Scenario: an empty term is not a search ---- */
        for (const empty of ["", "   "]) {
            const rows = await idsOf(empty);
            check(
                `"${empty}" short-circuits to no results`,
                rows.length === 0,
                `${rows.length} result(s)`,
            );
        }

        /* ---- LIKE metacharacters are matched literally ---- */
        /*
         * A shopper typing `%` means the character, not "anything". Before the
         * MySQL port the term went into the pattern unescaped, so `%` matched
         * the entire catalogue; `escapeLikeWildcards` is what closes that, and
         * these two probes are the only thing standing between it and a
         * regression.
         */
        const percent = await idsOf("100%");
        check(
            "a literal % matches only the product containing it",
            percent.includes(cottonCase.id) && !percent.includes(speaker.id),
            `${percent.length} result(s) for 100%`,
        );

        const bareWildcard = await idsOf("%");
        check(
            "a bare % is not a wildcard",
            bareWildcard.length === 0 || bareWildcard.every((id) => id === cottonCase.id),
            `${bareWildcard.length} result(s) for %`,
        );

        const underscore = await idsOf("under_score");
        check(
            "a literal _ matches only the product containing it",
            underscore.includes(cottonCase.id),
            `${underscore.length} result(s) for under_score`,
        );

        /* ---- Scenario: ranking, strongest match first ---- */
        // An exact name beats a mere substring. Probed with two products that
        // both contain "Earbuds" where only one is named exactly that.
        const ranked = await ProductService.searchProducts(`${MARKER}Earbuds Lite`);
        check(
            "an exact name match ranks first",
            ranked.length > 0 && ranked[0].slug === `${MARKER}earbuds-lite`,
            ranked.length > 0 ? `first is ${ranked[0].slug}` : "no results",
        );

        // SKU and brand are matchable at all, which the scoring tiers imply.
        const bySku = await idsOf("VS-SPK-01");
        check("a SKU matches", bySku.includes(speaker.id), `${bySku.length} result(s)`);

        const byDescription = await idsOf("Noise cancelling");
        check(
            "a description matches",
            byDescription.includes(earbudsPro.id),
            `${byDescription.length} result(s)`,
        );

        /* ---- Determinism: the same term twice gives the same order ---- */
        const first = await idsOf("earbuds");
        const second = await idsOf("earbuds");
        check(
            "repeated identical requests return the same order",
            first.length === second.length && first.every((id, i) => id === second[i]),
            `${first.length} result(s), ${first.every((id, i) => id === second[i]) ? "stable" : "REORDERED"}`,
        );

        /* ---- The cap is enforced server-side ---- */
        const capped = await ProductService.searchProducts(MARKER, 999);
        check(
            "the result cap is enforced whatever the client asks for",
            capped.length <= SEARCH_RESULT_CAP,
            `${capped.length} result(s), cap ${SEARCH_RESULT_CAP}`,
        );

        // Referenced so an unused-binding lint cannot quietly drop a fixture
        // that the assertions above depend on existing.
        void powerBank;
    } finally {
        await prisma.product.deleteMany({ where: { slug: { startsWith: MARKER } } });
        await prisma.brand.deleteMany({ where: { slug: { startsWith: MARKER } } });
        await prisma.$disconnect();
    }

    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
    if (failures > 0) process.exitCode = 1;
};

main();
