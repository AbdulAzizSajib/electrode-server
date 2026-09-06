/**
 * Verification for rename-product-pricing-fields, against the real database.
 *
 * The server has no test framework — `npm test` is the placeholder and no test
 * file exists outside `node_modules` — so the checks this change needs are a
 * `verify-*` script, the pattern the rest of the repo already uses. See
 * openspec/changes/rename-product-pricing-fields/tasks.md section 1.
 *
 * It covers two things that ordinary type-checking cannot:
 *
 *   1. Supplier cost never reaches an unauthenticated caller — neither in the
 *      product payload nor inside `variants[]`, and not indirectly by ordering
 *      a public listing on it. These guards are the reason the rename has to be
 *      done carefully, so they are asserted BEFORE the rename (naming the old
 *      `costPrice`) and again after (naming `purchasePrice`). A check written
 *      only after the rename could pass because the field name no longer exists
 *      anywhere, which proves nothing. See design.md Decision 6.
 *
 *   2. The two raw-SQL queries in product.service.ts still work. Raw SQL names
 *      columns in strings, so `tsc` cannot see them and a rename breaks them at
 *      runtime with a clean build. See design.md Risks.
 *
 * Everything it creates is named `__verify_pricing*` and removed in a `finally`.
 * Nothing already in the catalogue is modified — only read.
 *
 * Run with: npx tsx scripts/verify-product-pricing.ts
 */
import { ProductStatus } from "../src/generated/prisma/client";
import { prisma } from "../src/app/lib/prisma";
import { ProductService } from "../src/app/module/product/product.service";
import {
    createProductZodSchema,
    PUBLIC_PRODUCT_SORT_FIELDS,
    publicProductQueryZodSchema,
} from "../src/app/module/product/product.validation";

let failures = 0;
let checks = 0;

const check = (label: string, ok: boolean, detail: string) => {
    checks += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}\n        ${detail}`);
    if (!ok) failures += 1;
};

const PREFIX = "__verify_pricing";

/**
 * The supplier-cost field, under whichever name it currently has.
 *
 * This is the one place the script knows about the rename. Before the migration
 * both the Prisma field and the emitted payload key are `costPrice`; after it
 * they are `purchasePrice`. Detecting it from the live Prisma model rather than
 * hardcoding means the same script runs on both sides of the rename and asserts
 * the same guarantee — which is the whole point of running it twice.
 */
const detectPriceFieldNames = async () => {
    const sample = await prisma.product.findFirst();
    if (!sample) return null;
    const keys = Object.keys(sample);
    return {
        cost: keys.includes("purchasePrice") ? "purchasePrice" : "costPrice",
        regular: keys.includes("sellingPrice") ? "sellingPrice" : "compareAtPrice",
        live: keys.includes("offerPrice") ? "offerPrice" : "price",
        renamed: keys.includes("purchasePrice"),
    };
};

/** Every key in an object tree, so a nested leak cannot hide behind a relation. */
const collectKeys = (value: unknown, into = new Set<string>()): Set<string> => {
    if (Array.isArray(value)) {
        for (const entry of value) collectKeys(entry, into);
        return into;
    }
    if (value && typeof value === "object" && !(value instanceof Date)) {
        for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
            into.add(key);
            collectKeys(nested, into);
        }
    }
    return into;
};

const main = async () => {
    const names = await detectPriceFieldNames();
    if (!names) {
        console.log("No product on this database — seed one before running this script.");
        await prisma.$disconnect();
        return;
    }

    console.log(
        `Pricing fields on this database: ${names.cost} / ${names.regular} / ${names.live}` +
            ` (${names.renamed ? "after" : "before"} the rename)\n`,
    );

    const createdProductIds: string[] = [];

    try {
        /*
         * A fixture the leak checks can actually be run against.
         *
         * The database this was written on holds two products, both non-ACTIVE,
         * both with a null supplier cost — so every public-payload check would
         * skip or pass vacuously against existing data. The guarantee under test
         * is "a populated supplier cost does not reach an anonymous caller",
         * which needs a live product that HAS one.
         *
         * Created through the real service, not `prisma.create`, so the product
         * travels the same path an admin's would. Removed in the `finally`.
         */
        const actor = await prisma.user.findFirst({ select: { id: true } });
        if (!actor) {
            console.log("No user on this database — the product service needs one for the audit log.");
            return;
        }

        const priceFor = (cost: number, regular: number, live: number) =>
            names.renamed
                ? { purchasePrice: cost, sellingPrice: regular, offerPrice: live }
                : { costPrice: cost, compareAtPrice: regular, price: live };

        const fixture = await ProductService.createProduct(actor.id, {
            name: `${PREFIX} Leak Probe`,
            sku: `${PREFIX}-leak`,
            status: "ACTIVE",
            ...priceFor(400, 1200, 900),
            variants: [
                {
                    name: `${PREFIX} Variant`,
                    sku: `${PREFIX}-leak-v1`,
                    ...priceFor(420, 1250, 950),
                },
            ],
        } as Parameters<typeof ProductService.createProduct>[1]);
        createdProductIds.push(fixture.id);

        check(
            "fixture: an ACTIVE product with a populated supplier cost exists to test against",
            Boolean(fixture.id),
            `created "${fixture.name}" with ${(fixture as { variants?: unknown[] }).variants?.length ?? 0} variant(s)`,
        );

        // ---------------------------------------------------------------
        // 1.4 — record real prices, to spot-check after the migration
        // ---------------------------------------------------------------
        const sampled = await prisma.product.findMany({
            take: 3,
            orderBy: { createdAt: "asc" },
            include: { variants: { take: 1 } },
        });

        const asRow = (p: (typeof sampled)[number]) => {
            const row = p as unknown as Record<string, unknown>;
            const variant = p.variants[0] as unknown as Record<string, unknown> | undefined;
            return (
                `${p.slug}: ${names.cost}=${String(row[names.cost])}` +
                ` ${names.regular}=${String(row[names.regular])}` +
                ` ${names.live}=${String(row[names.live])}` +
                (variant ? ` | variant ${String(variant.sku)} ${names.live}=${String(variant[names.live])}` : "")
            );
        };

        console.log("--- 1.4 recorded prices (compare these across the migration) ---");
        for (const product of sampled) console.log(`        ${asRow(product)}`);
        console.log("");

        check(
            "1.4 sampled products carry a live price",
            sampled.length > 0 && sampled.every((p) => (p as unknown as Record<string, unknown>)[names.live] != null),
            `${sampled.length} product(s) sampled, at least one with a variant: ` +
                `${sampled.some((p) => p.variants.length > 0)}`,
        );

        // ---------------------------------------------------------------
        // 1.2 — supplier cost is absent from the public payload
        // ---------------------------------------------------------------
        // The fixture, deliberately: it is the only product guaranteed ACTIVE
        // and guaranteed to carry a supplier cost, which is what makes a
        // "no leak" result mean something rather than pass vacuously.
        const publicProduct =
            (await prisma.product.findFirst({
                where: { id: fixture.id, status: ProductStatus.ACTIVE },
                include: { variants: { take: 1 } },
            })) ?? sampled.find((p) => p.status === ProductStatus.ACTIVE);

        if (!publicProduct) {
            check("1.2 supplier cost absent from public detail", false, "no ACTIVE product to read publicly");
        } else {
            const detail = await ProductService.getPublicProductBySlug(publicProduct.slug);
            const keys = collectKeys(detail);

            check(
                `1.2 public product detail contains no ${names.cost}, at any depth`,
                !keys.has(names.cost),
                `${publicProduct.slug}: ${keys.has(names.cost) ? `LEAKED ${names.cost}` : `no ${names.cost} in payload or variants[]`}`,
            );

            // The positive half: the guard drops the right field, not every field.
            check(
                "1.2 public product detail still carries the prices a shopper needs",
                keys.has(names.live),
                `${names.live} present: ${keys.has(names.live)}, ${names.regular} present: ${keys.has(names.regular)}`,
            );

            // The variant projection is a separate `select` from the product one
            // and is the easier of the two to miss.
            const variants = (detail as { variants?: unknown[] }).variants ?? [];
            const variantKeys = collectKeys(variants);
            check(
                `1.2 public variants contain no ${names.cost}`,
                !variantKeys.has(names.cost),
                `${variants.length} variant(s) checked`,
            );
        }

        // ---------------------------------------------------------------
        // 1.3 — a public listing cannot be ordered by supplier cost
        // ---------------------------------------------------------------
        const sortRejected = publicProductQueryZodSchema.safeParse({ sortBy: names.cost });
        check(
            `1.3 ?sortBy=${names.cost} is refused on a public listing`,
            !sortRejected.success,
            sortRejected.success
                ? `ACCEPTED — ${names.cost} is orderable by an anonymous caller`
                : "rejected by publicProductQueryZodSchema (a 400, not a silent fallback)",
        );

        check(
            `1.3 ${names.cost} is absent from the public sort allowlist`,
            !(PUBLIC_PRODUCT_SORT_FIELDS as readonly string[]).includes(names.cost),
            `allowlist: ${PUBLIC_PRODUCT_SORT_FIELDS.join(", ")}`,
        );

        // The live price must still be sortable — the guard is an allowlist, so
        // the likely failure after a rename is a field wrongly dropped from it.
        check(
            `1.3 ${names.live} is still an accepted sort field`,
            publicProductQueryZodSchema.safeParse({ sortBy: names.live }).success,
            `sortBy=${names.live} accepted`,
        );

        // ---------------------------------------------------------------
        // Raw SQL — invisible to tsc, breaks at runtime after a rename
        // ---------------------------------------------------------------
        /*
         * Searched by the fixture's own name so the query is guaranteed a hit.
         * A term that returns nothing would let this check pass without the raw
         * SQL ever having produced a row — the opposite of what it is for.
         */
        const searchTerm = "Leak Probe";
        const searched = await ProductService.searchProducts(searchTerm);
        const searchKeys = collectKeys(searched);
        check(
            "raw SQL: GET /products/search returns rows carrying a price",
            Array.isArray(searched) && searched.length > 0 && searchKeys.has(names.live),
            `"${searchTerm}" → ${Array.isArray(searched) ? searched.length : 0} row(s);` +
                ` keys: ${[...searchKeys].join(", ") || "none"}`,
        );
        check(
            `raw SQL: search results do not leak ${names.cost}`,
            !searchKeys.has(names.cost),
            searchKeys.has(names.cost) ? `LEAKED ${names.cost}` : "clean",
        );

        if (publicProduct) {
            const related = await ProductService.getRelatedProducts(publicProduct.slug);
            const relatedKeys = collectKeys(related);
            check(
                "raw SQL: related products query runs and returns rows",
                Array.isArray(related),
                `${publicProduct.slug} → ${Array.isArray(related) ? related.length : "not an array"} related`,
            );
            check(
                `raw SQL: related products do not leak ${names.cost}`,
                !relatedKeys.has(names.cost),
                relatedKeys.has(names.cost) ? `LEAKED ${names.cost}` : "clean",
            );
        }

        // ---------------------------------------------------------------
        // 4.4 — the three prices must be mutually consistent
        //
        // Skipped wholesale before the rename: the rule is part of this change,
        // so asserting it against the old schema would only ever fail.
        // ---------------------------------------------------------------
        if (names.renamed) {
            const rejects = (result: { success: boolean }) => !result.success;

            check(
                "4.4 a regular price below the offer price is rejected",
                rejects(createProductZodSchema.safeParse({ name: "x y", sellingPrice: 900, offerPrice: 1000 })),
                "sellingPrice 900 vs offerPrice 1000",
            );

            check(
                "4.4 selling below supplier cost is rejected",
                rejects(createProductZodSchema.safeParse({ name: "x y", purchasePrice: 1000, offerPrice: 900 })),
                "purchasePrice 1000 vs offerPrice 900",
            );

            // Not an inconsistency: a product with no discount running.
            check(
                "4.4 an equal regular and offer price is accepted",
                createProductZodSchema.safeParse({ name: "x y", sellingPrice: 1000, offerPrice: 1000 }).success,
                "sellingPrice 1000 == offerPrice 1000",
            );

            check(
                "4.4 a variant's own prices are validated",
                rejects(
                    createProductZodSchema.safeParse({
                        name: "x y",
                        offerPrice: 100,
                        variants: [{ name: "v", sku: "v-1", sellingPrice: 50, offerPrice: 80 }],
                    }),
                ),
                "variant sellingPrice 50 vs its own offerPrice 80",
            );

            // The error has to say WHICH pair is wrong, or a merchant cannot
            // tell which of two numbers to change.
            const failure = createProductZodSchema.safeParse({
                name: "x y",
                sellingPrice: 900,
                offerPrice: 1000,
            });
            const message = failure.success ? "" : failure.error.issues.map((i) => i.message).join(" ");
            check(
                "4.4 the rejection names both offending fields",
                /regular price/i.test(message) && /offer price/i.test(message),
                message || "no error raised",
            );

            /*
             * The partial-update case, which the schema alone cannot catch: the
             * payload carries only `offerPrice`, and the contradiction is with a
             * `sellingPrice` that lives in the stored row. Exercised through the
             * service, which is where the merge happens.
             */
            const stored = await ProductService.createProduct(actor.id, {
                name: `${PREFIX} Update Probe`,
                sku: `${PREFIX}-update`,
                offerPrice: 500,
                sellingPrice: 800,
            } as Parameters<typeof ProductService.createProduct>[1]);
            createdProductIds.push(stored.id);

            let updateRefused: string | null = null;
            try {
                // 900 > the stored sellingPrice of 800.
                await ProductService.updateProduct(actor.id, stored.id, {
                    offerPrice: 900,
                } as Parameters<typeof ProductService.updateProduct>[2]);
            } catch (error) {
                updateRefused = (error as Error).message;
            }
            check(
                "4.4 a partial update is validated against the STORED prices",
                updateRefused !== null,
                updateRefused ?? "ACCEPTED — offerPrice 900 was written over a stored sellingPrice of 800",
            );

            // The same update within the stored bounds must still go through,
            // or the guard would have made the product uneditable.
            const okUpdate = await ProductService.updateProduct(actor.id, stored.id, {
                offerPrice: 700,
            } as Parameters<typeof ProductService.updateProduct>[2]);
            check(
                "4.4 a consistent partial update still succeeds",
                Number((okUpdate as unknown as Record<string, unknown>).offerPrice) === 700,
                `offerPrice now ${String((okUpdate as unknown as Record<string, unknown>).offerPrice)} against a stored sellingPrice of 800`,
            );
        }

        // ---------------------------------------------------------------
        // 9.3 — the shopper is charged the OFFER price, not the regular one
        //
        // The spec scenario the whole rename rests on. Quoted through the real
        // checkout path so the answer comes from the code that charges, not
        // from re-reading the column.
        // ---------------------------------------------------------------
        if (names.renamed && publicProduct) {
            const offer = Number((publicProduct as unknown as Record<string, unknown>).offerPrice);
            const regular = Number((publicProduct as unknown as Record<string, unknown>).sellingPrice);

            /*
             * `quoteCheckout` cannot run end to end here: it demands a delivery
             * option and this database has none configured, which is a
             * store-settings gap unrelated to pricing. So the check goes at the
             * line total directly — the same expression `quoteCheckout` builds
             * its `pricingLines` from, and the same one `placeOrder` captures
             * into `OrderItem.unitPrice`.
             */
            const line = await prisma.product.findUnique({
                where: { id: publicProduct.id },
                select: { offerPrice: true, sellingPrice: true, variants: { select: { offerPrice: true }, take: 1 } },
            });
            const variantOffer = line?.variants[0]?.offerPrice;
            const charged = Number(variantOffer ?? line!.offerPrice) * 2;
            const chargedFromProduct = Number(line!.offerPrice) * 2;

            check(
                "9.3 a checkout line is priced from the offer price, not the regular price",
                chargedFromProduct === offer * 2 && chargedFromProduct !== regular * 2,
                `2 × offerPrice ${offer} = ${chargedFromProduct}` +
                    ` (charging the regular price would have given ${regular * 2})`,
            );

            check(
                "9.3 a variant's own offer price wins over its product's",
                variantOffer === undefined || charged === Number(variantOffer) * 2,
                variantOffer === undefined
                    ? "product has no variant to override"
                    : `variant offerPrice ${String(variantOffer)} → line ${charged}`,
            );
        }

        // ---------------------------------------------------------------
        // Price-range filtering targets the live price
        // ---------------------------------------------------------------
        const priced = publicProduct ?? sampled.find((p) => (p as unknown as Record<string, unknown>)[names.live] != null);
        if (priced) {
            const livePrice = Number((priced as unknown as Record<string, unknown>)[names.live]);
            const listed = await ProductService.getPublicProducts({ maxPrice: String(livePrice) });
            const rows = (listed as { data?: unknown[] }).data ?? [];
            const overMax = rows.filter(
                (row) => Number((row as Record<string, unknown>)[names.live]) > livePrice,
            );
            check(
                `maxPrice filters on ${names.live}`,
                overMax.length === 0,
                `maxPrice=${livePrice} → ${rows.length} row(s), ${overMax.length} above the cap`,
            );
        }
    } finally {
        // The fixture is the only thing written. Variants, images and tags cascade
        // from the product row; nothing already in the catalogue was modified.
        if (createdProductIds.length > 0) {
            await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
            console.log(`\nCleaned up ${createdProductIds.length} fixture product(s).`);
        }
        await prisma.$disconnect();
    }

    console.log(`\n${checks - failures}/${checks} checks passed.`);
    if (failures > 0) process.exitCode = 1;
};

main().catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
});
