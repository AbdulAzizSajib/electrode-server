/**
 * Pins the property the whole package feature rests on: THE PAGE, THE QUOTE AND
 * THE ORDER ALL AGREE ABOUT WHAT A PACKAGE COSTS.
 *
 * This is not a general regression test. It exists because the exact failure it
 * checks for HAS ALREADY HAPPENED ONCE on this code path, in a
 * campaign-shaped rather than package-shaped form: the quote charged bare
 * `offerPrice` while the page and the order applied the running campaign, so
 * the form submitted an `expectedTotal` placement refused with a 409 — and
 * every order from the page failed, silently, for exactly as long as the
 * campaign it was advertising ran. See the comment in `quoteLandingPageOrder`.
 *
 * A package authors its own price, which makes a second divergence possible in
 * the same place. `resolveLandingPackage` is the one answer all three paths
 * read; these checks are what keep it that way.
 *
 * Covers, from openspec/changes/add-conversion-landing-page-sections:
 *   - the resolver's four cases: no packages, no key, a key, an unknown key
 *   - the snapshot, the quote and the ORDER all price the same package alike
 *   - a page with no packages prices exactly as it did before packages existed
 *   - the order records which package it was, and survives that package's
 *     deletion
 *
 * Creates `__verify_*`-prefixed rows and removes them in a `finally`.
 *
 * Run with:
 *   npx tsx scripts/verify-landing-packages.ts
 */
import { LandingPageStatus, ProductStatus } from "../src/generated/prisma/client";
import { prisma } from "../src/app/lib/prisma";
import { LandingPageService } from "../src/app/module/landing-page/landing-page.service";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

const thrownMessage = async (fn: () => Promise<unknown>): Promise<string | null> => {
    try {
        await fn();
        return null;
    } catch (error) {
        return (error as Error).message;
    }
};

const PREFIX = "__verify_lp_pkg";

const { resolveLandingPackage } = LandingPageService;

const main = async () => {
    /*
     * Two products at DIFFERENT prices, so a package resolving to the wrong one
     * is visible in the numbers rather than hidden behind a coincidence.
     */
    const [half, full] = await Promise.all([
        prisma.product.create({
            data: {
                name: `${PREFIX} 500g`,
                slug: `${PREFIX}-500g`,
                offerPrice: 700,
                sellingPrice: 1000,
                status: ProductStatus.ACTIVE,
            },
            select: { id: true },
        }),
        prisma.product.create({
            data: {
                name: `${PREFIX} 1kg`,
                slug: `${PREFIX}-1kg`,
                offerPrice: 1300,
                sellingPrice: 2000,
                status: ProductStatus.ACTIVE,
            },
            select: { id: true },
        }),
    ]);

    // Stock, so the page reports itself orderable and the quote can price it.
    const warehouse = await prisma.warehouse.findFirst({ select: { id: true } });
    if (warehouse) {
        await prisma.stock.createMany({
            data: [
                { productId: half.id, warehouseId: warehouse.id, quantity: 100 },
                { productId: full.id, warehouseId: warehouse.id, quantity: 100 },
            ],
            skipDuplicates: true,
        });
    }

    const zones = [{ key: "inside-dhaka", label: "ঢাকার ভিতরে", price: 60 }];
    const orderForm = {
        fields: {
            fullName: { label: "নাম", required: true },
            phone: { label: "মোবাইল" },
            address: { label: "ঠিকানা" },
        },
        submitLabel: "অর্ডার",
    };

    /*
     * AUTHORED PRICES DELIBERATELY DIFFER FROM THE PRODUCTS' OWN. A package
     * that happened to match its product's offerPrice would pass every check
     * below even if the override never reached placement.
     */
    const packages = [
        { key: "half-kg", label: "৫০০ গ্রাম", productId: half.id, price: 849, compareAtPrice: 1050 },
        {
            key: "one-kg",
            label: "১ কেজি",
            productId: full.id,
            price: 1599,
            compareAtPrice: 2100,
            freeGiftText: "+ ফ্রি ১ কেজি চিনিগুঁড়া চাল",
            preselected: true,
        },
    ];

    const [packaged, plain] = await Promise.all([
        prisma.landingPage.create({
            data: {
                title: `${PREFIX} packaged`,
                slug: `${PREFIX}-packaged`,
                status: LandingPageStatus.PUBLISHED,
                productId: half.id,
                headline: "প্যাকেজ",
                bodyHtml: "<p>x</p>",
                orderForm,
                packages,
            },
            select: { id: true, slug: true, productId: true, packages: true },
        }),
        prisma.landingPage.create({
            data: {
                title: `${PREFIX} plain`,
                slug: `${PREFIX}-plain`,
                status: LandingPageStatus.PUBLISHED,
                productId: half.id,
                headline: "সাধারণ",
                bodyHtml: "<p>x</p>",
                orderForm,
            },
            select: { id: true, slug: true, productId: true, packages: true },
        }),
    ]);

    try {
        /* ---------------------------------------------------------------- *
         * 1. The resolver's four cases.
         * ---------------------------------------------------------------- */

        const noPackages = resolveLandingPackage(plain);
        check(
            "resolver: a page with NO packages returns the bound product",
            noPackages.productId === half.id && noPackages.packageKey === null,
            `product ${noPackages.productId === half.id}, key ${noPackages.packageKey}`,
        );
        check(
            "resolver: no packages means NO authored price",
            noPackages.authoredPrice === null,
            "null tells the snapshot to read the product's own offerPrice, as before packages existed",
        );

        const defaulted = resolveLandingPackage(packaged);
        check(
            "resolver: no key given resolves to the PRESELECTED package",
            defaulted.packageKey === "one-kg" && defaulted.authoredPrice === 1599,
            `${defaulted.packageKey} at ${defaulted.authoredPrice}`,
        );

        const explicit = resolveLandingPackage(packaged, "half-kg");
        check(
            "resolver: an explicit key resolves to that package",
            explicit.packageKey === "half-kg" &&
                explicit.authoredPrice === 849 &&
                explicit.productId === half.id,
            `${explicit.packageKey} at ${explicit.authoredPrice}`,
        );

        let unknownMessage: string | null = null;
        try {
            resolveLandingPackage(packaged, "no-such-tier");
        } catch (error) {
            unknownMessage = (error as Error).message;
        }
        check(
            "resolver: an unknown key is REFUSED, never quietly defaulted",
            unknownMessage !== null,
            unknownMessage ??
                "it resolved to something — a shopper could be charged for a tier whose price they never read",
        );

        /* ---------------------------------------------------------------- *
         * 2. The snapshot prices each package.
         * ---------------------------------------------------------------- */

        const pageRead = (await LandingPageService.getPublishedBySlug(packaged.slug)) as {
            productSnapshot: { unitPrice: number; sellingPrice: number | null; name: string };
        } | null;

        check(
            "page render: snapshots the preselected package's price",
            pageRead?.productSnapshot.unitPrice === 1599,
            `rendered ${pageRead?.productSnapshot.unitPrice}, expected 1599`,
        );
        check(
            "page render: strikes through the PACKAGE's compareAtPrice",
            pageRead?.productSnapshot.sellingPrice === 2100,
            `struck ${pageRead?.productSnapshot.sellingPrice}, expected 2100 — not the product's own 2000`,
        );
        check(
            "page render: names the package, not the bare product",
            pageRead?.productSnapshot.name === "১ কেজি",
            `named "${pageRead?.productSnapshot.name}"`,
        );

        /* ---------------------------------------------------------------- *
         * 3. THE REGRESSION: quote and placement must agree, per package.
         * ---------------------------------------------------------------- */

        for (const pkg of packages) {
            const quote = await LandingPageService.quoteLandingPageOrder(packaged.slug, {
                quantity: 2,
                deliveryOptionKey: "option-2",
                packageKey: pkg.key,
            });

            const expectedSubtotal = pkg.price * 2;
            check(
                `quote: "${pkg.label}" prices at its authored price`,
                quote.subtotal === expectedSubtotal,
                `subtotal ${quote.subtotal}, expected ${expectedSubtotal}`,
            );

            /*
             * The order is placed with the quote's own total as `expectedTotal`
             * — exactly what the form does. If placement priced differently it
             * would refuse with a 409, which is the failure this whole script
             * exists for.
             */
            const { order } = (await LandingPageService.placeLandingPageOrder(
                { kind: "guest", ip: "127.0.0.1" } as never,
                packaged.slug,
                {
                    quantity: 2,
                    deliveryOptionKey: "option-2",
                    packageKey: pkg.key,
                    fullName: `${PREFIX} shopper`,
                    phone: "01711111111",
                    address: "Test address",
                    expectedTotal: quote.totalAmount,
                },
            )) as { order: { id: string; totalAmount: unknown } };

            check(
                `ORDER: "${pkg.label}" is accepted at the quoted total`,
                Number(order.totalAmount) === quote.totalAmount,
                `charged ${Number(order.totalAmount)}, quoted ${quote.totalAmount} — a mismatch here is the 409 that broke every order once before`,
            );

            const stored = await prisma.order.findUniqueOrThrow({
                where: { id: order.id },
                select: {
                    landingPackageKey: true,
                    landingPackageLabel: true,
                    landingPackagePrice: true,
                    items: { select: { productId: true, unitPrice: true } },
                },
            });

            check(
                `ORDER: "${pkg.label}" records which package it was`,
                stored.landingPackageKey === pkg.key && stored.landingPackageLabel === pkg.label,
                `key ${stored.landingPackageKey}, label ${stored.landingPackageLabel}`,
            );
            check(
                `ORDER: "${pkg.label}" charged the package's price per unit`,
                Number(stored.items[0]?.unitPrice) === pkg.price,
                `unit ${Number(stored.items[0]?.unitPrice)}, expected ${pkg.price}`,
            );
            check(
                `ORDER: "${pkg.label}" is for the package's OWN product`,
                stored.items[0]?.productId === pkg.productId,
                `product ${stored.items[0]?.productId === pkg.productId}`,
            );
        }

        /* ---------------------------------------------------------------- *
         * 4. An unknown key is refused at PLACEMENT too, with no order made.
         * ---------------------------------------------------------------- */

        const before = await prisma.order.count({ where: { landingPageId: packaged.id } });
        const refused = await thrownMessage(() =>
            LandingPageService.placeLandingPageOrder(
                { kind: "guest", ip: "127.0.0.1" } as never,
                packaged.slug,
                {
                    quantity: 1,
                    deliveryOptionKey: "option-2",
                    packageKey: "no-such-tier",
                    fullName: `${PREFIX} shopper`,
                    phone: "01711111111",
                    address: "Test address",
                },
            ),
        );
        const after = await prisma.order.count({ where: { landingPageId: packaged.id } });

        check(
            "placement: an unknown package key is refused",
            refused !== null,
            refused ?? "it was accepted",
        );
        check(
            "placement: the refusal created no order",
            before === after,
            `${before} before, ${after} after`,
        );

        /* ---------------------------------------------------------------- *
         * 5. A page with NO packages is unchanged.
         * ---------------------------------------------------------------- */

        const plainQuote = await LandingPageService.quoteLandingPageOrder(plain.slug, {
            quantity: 1,
            deliveryOptionKey: "option-2",
        });
        check(
            "no packages: prices from the bound product's own offerPrice",
            plainQuote.subtotal === 700,
            `subtotal ${plainQuote.subtotal}, expected the product's 700`,
        );

        const { order: plainOrder } = (await LandingPageService.placeLandingPageOrder(
            { kind: "guest", ip: "127.0.0.1" } as never,
            plain.slug,
            {
                quantity: 1,
                deliveryOptionKey: "option-2",
                fullName: `${PREFIX} shopper`,
                phone: "01711111111",
                address: "Test address",
                expectedTotal: plainQuote.totalAmount,
            },
        )) as { order: { id: string } };

        const plainStored = await prisma.order.findUniqueOrThrow({
            where: { id: plainOrder.id },
            select: { landingPackageKey: true, landingPackageLabel: true },
        });
        check(
            "no packages: the order names NO package",
            plainStored.landingPackageKey === null && plainStored.landingPackageLabel === null,
            "null, as for every order from the normal checkout",
        );

        /* ---------------------------------------------------------------- *
         * 6. An order survives its package being deleted.
         * ---------------------------------------------------------------- */

        await prisma.landingPage.update({
            where: { id: packaged.id },
            data: { packages: [packages[0]] },
        });

        const orphaned = await prisma.order.findFirst({
            where: { landingPageId: packaged.id, landingPackageKey: "one-kg" },
            select: { landingPackageLabel: true, landingPackagePrice: true },
        });
        check(
            "a deleted package leaves its orders still saying what was sold",
            orphaned?.landingPackageLabel === "১ কেজি" &&
                Number(orphaned?.landingPackagePrice) === 1599,
            `label "${orphaned?.landingPackageLabel}" at ${Number(orphaned?.landingPackagePrice)} — captured at placement, not read back from the page`,
        );
    } finally {
        const pages = [packaged.id, plain.id];
        await prisma.order.deleteMany({ where: { landingPageId: { in: pages } } });
        await prisma.landingPage.deleteMany({ where: { id: { in: pages } } });
        await prisma.stock.deleteMany({ where: { productId: { in: [half.id, full.id] } } });
        await prisma.product.deleteMany({ where: { id: { in: [half.id, full.id] } } });
        await prisma.customer.deleteMany({ where: { phone: "01711111111" } });
    }
};

main()
    .then(() => {
        console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
        process.exit(failures === 0 ? 0 : 1);
    })
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
