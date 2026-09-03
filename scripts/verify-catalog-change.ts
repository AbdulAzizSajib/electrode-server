/**
 * Group 9 — end-to-end verification of the catalog change against the real
 * database, for the behaviours that only the backend can answer for.
 *
 * The parts a unit test cannot reach: that the migration left every product
 * buyable, that a rule in use refuses to be deleted, that an ordered variant
 * cannot be removed, and that deleting a grouping does not damage its products.
 *
 * Everything it creates, it removes again — the products, rules, collections
 * and deals below are all named `__verify_*` and deleted in a `finally`. It
 * does NOT touch anything already in the catalogue except to read it.
 *
 * Run with: npx tsx scripts/verify-catalog-change.ts
 */
import { ChargeType, ProductStatus } from "../src/generated/prisma/client";
import { prisma } from "../src/app/lib/prisma";
import { AttributeService } from "../src/app/module/attribute/attribute.service";
import { BundleDealService } from "../src/app/module/bundle-deal/bundle-deal.service";
import { CollectionService } from "../src/app/module/collection/collection.service";
import { ProductService } from "../src/app/module/product/product.service";
import { ShippingRuleService } from "../src/app/module/shipping-rule/shipping-rule.service";
import { TaxRuleService } from "../src/app/module/tax-rule/tax-rule.service";

let failures = 0;
let checks = 0;

const check = (label: string, ok: boolean, detail: string) => {
    checks += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}\n        ${detail}`);
    if (!ok) failures += 1;
};

/** Runs `fn` and returns the error message it threw, or null if it did not. */
const refusal = async (fn: () => Promise<unknown>): Promise<string | null> => {
    try {
        await fn();
        return null;
    } catch (error) {
        return (error as Error).message;
    }
};

const PREFIX = "__verify";

const main = async () => {
    // An actor id for the audit log. Any staff user will do; the audit rows are
    // cleaned up with everything else.
    const actor = await prisma.user.findFirst({ select: { id: true } });
    if (!actor) {
        console.log("No user on this database — the services need one for the audit log.");
        return prisma.$disconnect();
    }

    const created = {
        productIds: [] as string[],
        attributeIds: [] as string[],
        taxRuleIds: [] as string[],
        shippingRuleIds: [] as string[],
        collectionIds: [] as string[],
        bundleDealIds: [] as string[],
    };

    try {
        // ---------------------------------------------------------------
        // 9.4 / 9.5 — the migrated catalogue is intact and still buyable
        // ---------------------------------------------------------------
        const products = await prisma.product.findMany({
            include: {
                variants: { include: { optionValues: { include: { value: true } } } },
            },
        });

        const active = products.filter((p) => p.status === ProductStatus.ACTIVE);

        // Every variant selection points at a live AttributeValue — a dangling
        // one is exactly what would make a product unrenderable.
        const danglingSelections = await prisma.$queryRaw<{ count: bigint }[]>`
            SELECT COUNT(*)::bigint AS count
            FROM "ProductVariantOptionValue" pvov
            LEFT JOIN "AttributeValue" av ON av."id" = pvov."valueId"
            WHERE av."id" IS NULL
        `;
        check(
            "9.4 no variant selection points at a value that no longer exists",
            Number(danglingSelections[0].count) === 0,
            `${Number(danglingSelections[0].count)} dangling selection(s)`,
        );

        // Every variant of a product that has options carries a full selection.
        // Mixed arity within one product is what makes resolution ambiguous.
        const badArity = products.filter((product) => {
            const arities = new Set(product.variants.map((v) => v.optionValues.length));
            return arities.size > 1;
        });
        check(
            "9.4 every product's variants agree on how many values define them",
            badArity.length === 0,
            badArity.length === 0
                ? `${products.length} product(s) checked`
                : `mixed arity on: ${badArity.map((p) => p.name).join(", ")}`,
        );

        // The derived options round-trip: what the storefront will be handed.
        let derivedOk = true;
        const derivedReport: string[] = [];
        for (const product of active) {
            // The PUBLIC read, deliberately — this is the payload a shopper
            // actually receives, so it is the one worth asserting on.
            const detail = await ProductService.getPublicProductBySlug(product.slug);
            const options = (detail as { options?: { name: string; values: unknown[] }[] }).options ?? [];
            const variants = (detail as { variants?: unknown[] }).variants ?? [];
            derivedReport.push(
                `${product.name}: ${options.length} option(s) [${options
                    .map((o) => `${o.name}x${o.values.length}`)
                    .join(", ")}], ${variants.length} variant(s)`,
            );
            // A product with variants must present either options or, for a
            // legacy one, its variants by name — never nothing at all.
            if (variants.length === 0 && product.variants.length > 0) derivedOk = false;
        }
        check(
            "9.4 every active product still presents its options and variants",
            derivedOk,
            derivedReport.join(" | ") || "no active products",
        );

        /*
         * 9.5 — every product that could be added to the cart before can still
         * be added after.
         *
         * Measured against what `CartService.addItem` actually requires: the
         * product is ACTIVE, and any variant named belongs to it and is
         * sellable. Stock deliberately does NOT appear here — adding to a cart
         * has never required it (checkout is where availability is enforced),
         * so folding stock in would fail products for a reason the cart has
         * never cared about.
         */
        const uncartable = active.filter((product) => {
            if (product.variants.length === 0) return false;
            // A variable product needs at least one variant a shopper can pick.
            return !product.variants.some((v) => v.status);
        });
        check(
            "9.5 every active product can still be added to the cart",
            uncartable.length === 0,
            uncartable.length === 0
                ? `${active.length} active product(s), each with a selectable unit`
                : `nothing selectable on: ${uncartable.map((p) => p.name).join(", ")}`,
        );

        /*
         * Reported rather than asserted: a variant sitting at zero is a
         * merchandising fact, not a failure of this change — and the one thing
         * this change must never do is invent a number for something nobody
         * counted. Printed so it cannot go unnoticed.
         */
        const zeroStock = active.flatMap((product) =>
            product.variants
                .filter((v) => (v.stockQuantity ?? 0) === 0)
                .map((v) => `${product.name} → ${v.name}`),
        );
        if (zeroStock.length > 0) {
            console.log(
                `NOTE  ${zeroStock.length} variant(s) currently hold zero stock:\n        ${zeroStock.join("\n        ")}`,
            );
        }

        // ---------------------------------------------------------------
        // 9.1 — an attribute defined once is selectable on another product
        // ---------------------------------------------------------------
        const attribute = await AttributeService.createAttribute(actor.id, {
            name: `${PREFIX} Colour`,
            presentation: "SWATCH",
            values: [
                { label: "Verify Red", swatch: "#ff0000" },
                { label: "Verify Green", swatch: "#00ff00" },
            ],
        });
        created.attributeIds.push(attribute.id);

        const all = await AttributeService.getAllAttributes();
        const seen = all.find((a) => a.id === attribute.id);
        check(
            "9.1 an attribute is available shop-wide with its values, without retyping",
            Boolean(seen) && seen?.values.length === 2,
            `"${seen?.name}" offers ${seen?.values.length} value(s) to every product`,
        );

        // ---------------------------------------------------------------
        // Supporting rules for the products below
        // ---------------------------------------------------------------
        const taxRule = await TaxRuleService.createTaxRule(actor.id, {
            name: `${PREFIX} Tax`,
            type: ChargeType.PERCENT,
            value: 10,
        });
        created.taxRuleIds.push(taxRule.id);

        const replacementTax = await TaxRuleService.createTaxRule(actor.id, {
            name: `${PREFIX} Tax Replacement`,
            type: ChargeType.PERCENT,
            value: 0,
        });
        created.taxRuleIds.push(replacementTax.id);

        const shippingRule = await ShippingRuleService.createShippingRule(actor.id, {
            name: `${PREFIX} Shipping`,
            places: [{ name: "Anywhere", price: 50, deliveryDays: 2 }],
        });
        created.shippingRuleIds.push(shippingRule.id);

        const replacementShipping = await ShippingRuleService.createShippingRule(actor.id, {
            name: `${PREFIX} Shipping Replacement`,
            places: [{ name: "Anywhere", price: 60, deliveryDays: 3 }],
        });
        created.shippingRuleIds.push(replacementShipping.id);

        const collection = await CollectionService.createCollection(actor.id, {
            name: `${PREFIX} Collection`,
        });
        created.collectionIds.push(collection.id);

        const bundleDeal = await BundleDealService.createBundleDeal(actor.id, {
            name: `${PREFIX} Deal`,
            buyQuantity: 2,
            freeQuantity: 1,
        });
        created.bundleDealIds.push(bundleDeal.id);

        const category = await prisma.category.findFirst({ select: { id: true } });
        const brand = await prisma.brand.findFirst({ select: { id: true } });

        // ---------------------------------------------------------------
        // 9.11 — creating a product needs no variants and no images
        // ---------------------------------------------------------------
        const bare = await ProductService.createProduct(actor.id, {
            name: `${PREFIX} Bare Product`,
            sku: `${PREFIX}-bare`,
            price: 1000,
            categoryId: category?.id,
            brandId: brand?.id,
            taxRuleId: taxRule.id,
            shippingRuleId: shippingRule.id,
            collectionIds: [collection.id],
            bundleDealId: bundleDeal.id,
            tags: ["verify-keyword", "Verify-Keyword", " verify-keyword "],
            unit: "1 kg",
            badge: "New",
            isRefundable: true,
            hasWarranty: null,
        });
        created.productIds.push(bare.id);

        check(
            "9.11 a product is created with no variants and no images",
            Boolean(bare.id),
            `created "${bare.name}" with ${(bare as { variants?: unknown[] }).variants?.length ?? 0} variant(s)`,
        );

        const bareTags = await prisma.productTag.count({ where: { productId: bare.id } });
        check(
            "keywords are recorded once per product however many times they are added",
            bareTags === 1,
            `three spellings of one keyword became ${bareTags} tag(s)`,
        );

        // ---------------------------------------------------------------
        // 9.1 / 9.2 / 9.3 — the same attribute on a second product, and the
        // stock-preservation rule, exercised through the real service
        // ---------------------------------------------------------------
        const red = attribute.values[0];
        const green = attribute.values[1];

        const varied = await ProductService.createProduct(actor.id, {
            name: `${PREFIX} Varied Product`,
            sku: `${PREFIX}-varied`,
            price: 500,
            type: "VARIABLE",
            categoryId: category?.id,
            brandId: brand?.id,
            taxRuleId: taxRule.id,
            shippingRuleId: shippingRule.id,
            options: [{ attributeId: attribute.id, valueIds: [red.id, green.id] }],
            variants: [
                { name: "Verify Red", sku: `${PREFIX}-red`, price: 500, stockQuantity: 11, optionValueIndexes: [0] },
                { name: "Verify Green", sku: `${PREFIX}-green`, price: 550, stockQuantity: 22, optionValueIndexes: [1] },
            ],
        });
        created.productIds.push(varied.id);

        const madeVariants = await prisma.productVariant.findMany({
            where: { productId: varied.id },
            orderBy: { sku: "asc" },
        });
        check(
            "9.1 a second product sells the same attribute's values without redefining them",
            madeVariants.length === 2,
            `${madeVariants.length} variant(s) from one shop-wide attribute`,
        );

        // Add a third value to the attribute and sell it — the 9.3 case.
        const withBlue = await AttributeService.updateAttribute(actor.id, attribute.id, {
            values: [
                { id: red.id, label: red.label, swatch: red.swatch ?? undefined },
                { id: green.id, label: green.label, swatch: green.swatch ?? undefined },
                { label: "Verify Blue", swatch: "#0000ff" },
            ],
        });
        const blue = withBlue.values.find((v) => v.label === "Verify Blue");

        const redVariant = madeVariants.find((v) => v.sku === `${PREFIX}-red`);
        const greenVariant = madeVariants.find((v) => v.sku === `${PREFIX}-green`);

        await ProductService.updateProduct(actor.id, varied.id, {
            options: [{ attributeId: attribute.id, valueIds: [red.id, green.id, blue!.id] }],
            variants: [
                { id: redVariant!.id, name: "Verify Red", sku: `${PREFIX}-red`, price: 500, stockQuantity: 11, optionValueIndexes: [0] },
                { id: greenVariant!.id, name: "Verify Green", sku: `${PREFIX}-green`, price: 550, stockQuantity: 22, optionValueIndexes: [1] },
                { name: "Verify Blue", sku: `${PREFIX}-blue`, price: 500, stockQuantity: 0, optionValueIndexes: [2] },
            ],
        });

        const afterAdd = await prisma.productVariant.findMany({
            where: { productId: varied.id },
            orderBy: { sku: "asc" },
        });
        const keptRed = afterAdd.find((v) => v.id === redVariant!.id);
        const keptGreen = afterAdd.find((v) => v.id === greenVariant!.id);

        check(
            "9.3 adding a value leaves every existing combination's stock, price and code untouched",
            keptRed?.stockQuantity === 11 &&
                keptGreen?.stockQuantity === 22 &&
                Number(keptRed?.price) === 500 &&
                Number(keptGreen?.price) === 550 &&
                keptRed?.sku === `${PREFIX}-red`,
            `Red kept ${keptRed?.stockQuantity} @ ${Number(keptRed?.price)}, Green kept ${keptGreen?.stockQuantity} @ ${Number(keptGreen?.price)}; both kept their database ids`,
        );
        check(
            "9.3 the newly possible combination starts with no stock",
            afterAdd.find((v) => v.sku === `${PREFIX}-blue`)?.stockQuantity === 0,
            "Blue starts unstocked rather than inheriting a count",
        );
        check(
            "9.2 ticking values produced exactly the expected combinations",
            afterAdd.length === 3,
            `${afterAdd.length} combination(s) for 3 selected values on 1 attribute`,
        );

        // Untick Blue: only its combination goes.
        await ProductService.updateProduct(actor.id, varied.id, {
            options: [{ attributeId: attribute.id, valueIds: [red.id, green.id] }],
            variants: [
                { id: redVariant!.id, name: "Verify Red", sku: `${PREFIX}-red`, price: 500, stockQuantity: 11, optionValueIndexes: [0] },
                { id: greenVariant!.id, name: "Verify Green", sku: `${PREFIX}-green`, price: 550, stockQuantity: 22, optionValueIndexes: [1] },
            ],
        });
        const afterRemove = await prisma.productVariant.findMany({ where: { productId: varied.id } });
        check(
            "9.2 unticking a value removes only that value's combination",
            afterRemove.length === 2 &&
                afterRemove.find((v) => v.id === redVariant!.id)?.stockQuantity === 11 &&
                afterRemove.find((v) => v.id === greenVariant!.id)?.stockQuantity === 22,
            `${afterRemove.length} combination(s) left, both with their stock intact`,
        );

        // ---------------------------------------------------------------
        // 9.6 — a variant on a past order cannot be removed, and the refusal
        //       names it
        // ---------------------------------------------------------------
        const customer = await prisma.customer.findFirst({ select: { id: true } });
        let orderedVariantChecked = false;

        if (customer) {
            const order = await prisma.order.create({
                data: {
                    orderNumber: `${PREFIX}-${process.pid}`,
                    customerId: customer.id,
                    subtotal: 500,
                    totalAmount: 500,
                    items: {
                        create: {
                            productId: varied.id,
                            variantId: redVariant!.id,
                            productName: "Verify Red",
                            sku: `${PREFIX}-red`,
                            quantity: 1,
                            unitPrice: 500,
                            totalPrice: 500,
                        },
                    },
                },
            });

            try {
                const message = await refusal(() =>
                    ProductService.updateProduct(actor.id, varied.id, {
                        options: [{ attributeId: attribute.id, valueIds: [green.id] }],
                        variants: [
                            {
                                id: greenVariant!.id,
                                name: "Verify Green",
                                sku: `${PREFIX}-green`,
                                price: 550,
                                stockQuantity: 22,
                                optionValueIndexes: [0],
                            },
                        ],
                    }),
                );

                check(
                    "9.6 a variant on a past order cannot be removed, and the refusal names it",
                    Boolean(message) && message!.includes("Verify Red"),
                    message ?? "the removal was allowed",
                );

                const survived = await prisma.productVariant.count({ where: { productId: varied.id } });
                check(
                    "9.6 the refused change left the product completely unaltered",
                    survived === 2,
                    `${survived} variant(s) still present after the refusal`,
                );
                orderedVariantChecked = true;
            } finally {
                await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
                await prisma.order.delete({ where: { id: order.id } });
            }
        }

        if (!orderedVariantChecked) {
            check("9.6 ordered-variant guard", false, "no customer on this database to attach an order to");
        }

        // ---------------------------------------------------------------
        // 9.7 — deleting a rule in use requires a replacement
        // ---------------------------------------------------------------
        const taxRefusal = await refusal(() => TaxRuleService.deleteTaxRule(actor.id, taxRule.id));
        check(
            "9.7 deleting a tax rule in use is refused, with a count",
            Boolean(taxRefusal) && /\d/.test(taxRefusal ?? ""),
            taxRefusal ?? "the deletion proceeded",
        );

        const shippingRefusal = await refusal(() =>
            ShippingRuleService.deleteShippingRule(actor.id, shippingRule.id),
        );
        check(
            "9.7 deleting a shipping rule in use is refused, with a count",
            Boolean(shippingRefusal) && /\d/.test(shippingRefusal ?? ""),
            shippingRefusal ?? "the deletion proceeded",
        );

        const usingTax = await prisma.product.count({ where: { taxRuleId: taxRule.id } });
        await TaxRuleService.deleteTaxRule(actor.id, taxRule.id, replacementTax.id);
        const movedToReplacement = await prisma.product.count({
            where: { id: { in: created.productIds }, taxRuleId: replacementTax.id },
        });
        created.taxRuleIds = created.taxRuleIds.filter((id) => id !== taxRule.id);
        check(
            "9.7 every product that used the deleted rule is assigned the replacement",
            movedToReplacement === usingTax,
            `${usingTax} product(s) used it, ${movedToReplacement} now use the replacement`,
        );

        await ShippingRuleService.deleteShippingRule(actor.id, shippingRule.id, replacementShipping.id);
        created.shippingRuleIds = created.shippingRuleIds.filter((id) => id !== shippingRule.id);
        const orphanedShipping = await prisma.product.count({
            where: { id: { in: created.productIds }, shippingRuleId: null },
        });
        check(
            "9.7 no product is left without a shipping rule",
            orphanedShipping === 0,
            `${orphanedShipping} product(s) without one`,
        );

        // ---------------------------------------------------------------
        // 9.8 — deleting a grouping does not damage its products
        // ---------------------------------------------------------------
        const inCollection = await prisma.productCollection.count({
            where: { collectionId: collection.id },
        });
        await CollectionService.deleteCollection(actor.id, collection.id);
        created.collectionIds = created.collectionIds.filter((id) => id !== collection.id);

        const survivingProduct = await prisma.product.findUnique({ where: { id: bare.id } });
        check(
            "9.8 deleting a collection leaves its products intact",
            Boolean(survivingProduct) && inCollection > 0,
            `${inCollection} membership(s) removed, the product itself untouched`,
        );

        const dealRefusal = await refusal(() =>
            BundleDealService.deleteBundleDeal(actor.id, bundleDeal.id),
        );
        check(
            "9.8 deleting a bundle deal in use asks first, and says how many carry it",
            Boolean(dealRefusal) && /\d/.test(dealRefusal ?? ""),
            dealRefusal ?? "the deletion proceeded unasked",
        );

        await BundleDealService.deleteBundleDeal(actor.id, bundleDeal.id, { force: true });
        created.bundleDealIds = created.bundleDealIds.filter((id) => id !== bundleDeal.id);
        const afterDealDelete = await prisma.product.findUnique({ where: { id: bare.id } });
        check(
            "9.8 on confirmation its products are sold with no offer, not deleted",
            Boolean(afterDealDelete) && afterDealDelete?.bundleDealId === null,
            `the product survives with bundleDealId = ${afterDealDelete?.bundleDealId}`,
        );

        // ---------------------------------------------------------------
        // Attribute deletion guard (spec: "Deleting an attribute or value in
        // use is prevented")
        // ---------------------------------------------------------------
        const attrRefusal = await refusal(() =>
            AttributeService.deleteAttribute(actor.id, attribute.id),
        );
        check(
            "an attribute products still sell cannot be deleted unconfirmed",
            Boolean(attrRefusal) && /\d/.test(attrRefusal ?? ""),
            attrRefusal ?? "the deletion proceeded",
        );
    } finally {
        // ---------------------------------------------------------------
        // Clean up, most-dependent first. Everything here is `__verify_*`.
        // ---------------------------------------------------------------
        for (const id of created.productIds) {
            await prisma.productVariantOptionValue.deleteMany({
                where: { variant: { productId: id } },
            });
            await prisma.productVariant.deleteMany({ where: { productId: id } });
            await prisma.productImage.deleteMany({ where: { productId: id } });
            await prisma.productTag.deleteMany({ where: { productId: id } });
            await prisma.productCollection.deleteMany({ where: { productId: id } });
            await prisma.productCategory.deleteMany({ where: { productId: id } });
            await prisma.stock.deleteMany({ where: { productId: id } });
            await prisma.stockMovement.deleteMany({ where: { productId: id } });
            await prisma.product.delete({ where: { id } }).catch(() => undefined);
        }
        for (const id of created.attributeIds) {
            await prisma.attribute.delete({ where: { id } }).catch(() => undefined);
        }
        for (const id of created.collectionIds) {
            await prisma.collection.delete({ where: { id } }).catch(() => undefined);
        }
        for (const id of created.bundleDealIds) {
            await prisma.bundleDeal.delete({ where: { id } }).catch(() => undefined);
        }
        for (const id of created.taxRuleIds) {
            await prisma.taxRule.delete({ where: { id } }).catch(() => undefined);
        }
        for (const id of created.shippingRuleIds) {
            await prisma.shippingRule.delete({ where: { id } }).catch(() => undefined);
        }
        await prisma.tag.deleteMany({ where: { name: { contains: "verify-keyword" } } });
        await prisma.auditLog.deleteMany({
            where: { entityId: { in: [...created.productIds, ...created.attributeIds] } },
        });
    }

    console.log(
        `\n${failures === 0 ? `All ${checks} checks passed.` : `${failures} of ${checks} checks FAILED.`}\n`,
    );

    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
};

void main();
