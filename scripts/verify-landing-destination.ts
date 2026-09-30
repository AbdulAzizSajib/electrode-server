/**
 * A campaign order is priced by the SHOP's delivery options, and by nothing
 * else.
 *
 * Before `add-landing-page-destination-picker` a landing page carried its own
 * `deliveryZones` and charged them through `shippingOverride` — a path that
 * deliberately bypassed `quoteDelivery` and both waivers. The effect was two
 * price lists for one shop: the same customer at the same address paid one
 * figure through the catalogue and another through an ad, and a merchant
 * raising their outside-Dhaka rate in Checkout Setting changed only one of
 * them. This script exists to keep that from coming back, because nothing else
 * would notice — the campaign would simply charge a different number, and the
 * only witness is an order nobody is comparing.
 *
 * So the assertions are not "does delivery pricing work". They are "does the
 * campaign path produce the SAME answer as the catalogue path", which is the
 * property that was broken and the one that breaks again the moment either
 * side grows its own copy.
 *
 * Covers, from openspec/changes/add-landing-page-destination-picker:
 *   - a served district prices from the shop's own option (tasks 5.2, 5.3)
 *   - the campaign and the shop quote the SAME charge for one option (task 5.3)
 *   - an option key the shop does not have is refused, and no order is made
 *   - a client-supplied delivery amount is not honoured
 *   - the free-shipping threshold now REACHES a campaign order (task 2.3,
 *     design.md Decision 5) — the behaviour change this change deliberately
 *     brings, pinned here so it is a decision on the record rather than a
 *     surprise in an order
 *   - the destination is recorded in the columns a shop order uses
 *
 * WHAT THIS SCRIPT CANNOT DO, stated so its absence is not read as an
 * oversight: `resolveDeliveryOption` — the map from a district to an option key
 * — is storefront-only, by design.md Decision 4. It cannot be imported from
 * here (different tsconfig, different module resolution), and its own unit
 * tests live in `frontend/src/lib/delivery-destination.test.ts`. What IS checked
 * here is the seam between them: that the option keys that file resolves to are
 * keys this shop actually has. A rename on either side is otherwise silent.
 *
 * Mutating: creates `__verify_dest_`-prefixed rows and restores the store's
 * free-shipping threshold in the `finally`. Run with:
 *   npx tsx scripts/verify-landing-destination.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LandingPageStatus, ProductStatus } from "../src/generated/prisma/client";
import { prisma } from "../src/app/lib/prisma";
import { LandingPageService } from "../src/app/module/landing-page/landing-page.service";
import { OrderService } from "../src/app/module/order/order.service";
import { StoreSettingService } from "../src/app/module/store-setting/store-setting.service";

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

const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

const PREFIX = "__verify_dest_";
const PHONE = "01722222222";

/** Repo root, from server/scripts. */
const ROOT = join(import.meta.dirname, "..", "..");

const main = async () => {
    /* ------------------------------------------------------------------ *
     * 0. The seam: the keys the storefront resolves to are keys this shop
     *    has.
     * ------------------------------------------------------------------ */

    const storeSetting = await StoreSettingService.getStoreSetting();
    const checkoutConfig = StoreSettingService.checkoutConfigOf(storeSetting.checkoutConfig);
    const options = checkoutConfig.delivery.options;

    if (options.length === 0) {
        console.log(
            "This store has no delivery options configured, so there is no price list to check against. Configure Checkout Setting → Delivery first.",
        );
        return;
    }

    /*
     * Read as TEXT, for the same reason `verify-landing-page-shapes.ts` reads
     * its mirrors that way: the storefront cannot be imported from here, and a
     * shallow check that actually runs is worth more than a perfect one that
     * never does.
     *
     * What this catches is the failure mode with no other witness — a merchant
     * renaming an option key, or the resolver being pointed at a new one, after
     * which every served district falls through to OPTION_NOT_CONFIGURED and
     * every campaign shopper is dropped to the cards. The page still works. It
     * just stops deriving anything, silently.
     */
    const resolverSource = readFileSync(
        join(ROOT, "frontend", "src", "lib", "delivery-destination.ts"),
        "utf-8",
    );
    /*
     * Anchored on the CONST DECLARATION, not the bare name. The name also
     * appears in a doc comment further up the file and in the resolver
     * below, and matching the first mention walks off into a comment and
     * finds no option keys at all — which reads as "the storefront resolves
     * to nothing" rather than as a broken pattern.
     */
    const zoneMap =
        resolverSource.match(/const ZONE_OPTION_KEY[^{]*\{[^}]+\}/)?.[0] ?? "";
    /*
     * The VALUES, not the keys. `ZONE_OPTION_KEY` reads `INSIDE_DHAKA:
     * "option-2"` — the zone name is a bare identifier and the option key is
     * the quoted half, so matching every quoted string would collect the zone
     * names too and report them as options this shop is missing. Anchored on
     * the colon for that reason.
     */
    const resolvedKeys = [...zoneMap.matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1]!);

    check(
        "the storefront resolver names at least one option key",
        resolvedKeys.length > 0,
        resolvedKeys.length > 0
            ? `ZONE_OPTION_KEY maps to ${resolvedKeys.join(", ")}`
            : "could not read ZONE_OPTION_KEY — the check below is meaningless without it",
    );

    const configuredKeys = new Set(options.map((o) => o.key));
    const unbacked = resolvedKeys.filter((key) => !configuredKeys.has(key));
    check(
        "every key the storefront resolves to is an option this shop has",
        unbacked.length === 0,
        unbacked.length === 0
            ? `all of ${resolvedKeys.join(", ")} exist in Checkout Setting`
            : `NOT CONFIGURED: ${unbacked.join(", ")} — every shopper in that zone is dropped to the cards`,
    );

    /*
     * The option the rest of the script prices against: one the resolver
     * actually reaches, so these checks exercise the live path rather than an
     * arbitrary row. Falls back to the first DELIVERY option so the script
     * still says something useful on a shop whose keys have drifted.
     */
    const servedOption =
        options.find((o) => o.kind === "DELIVERY" && resolvedKeys.includes(o.key)) ??
        options.find((o) => o.kind === "DELIVERY");

    if (!servedOption) {
        console.log("This store has no DELIVERY option (pickup only); nothing to price. Skipping.");
        return;
    }

    /* ------------------------------------------------------------------ *
     * Fixtures.
     * ------------------------------------------------------------------ */

    const category = await prisma.category.findFirst({ select: { id: true } });
    if (!category) {
        console.log("No category exists; cannot create a probe product. Skipping.");
        return;
    }

    const product = await prisma.product.create({
        data: {
            name: `${PREFIX}product`,
            slug: `${PREFIX}product`,
            sku: `${PREFIX}SKU`,
            categoryId: category.id,
            status: ProductStatus.ACTIVE,
            offerPrice: 500,
            sellingPrice: 700,
        },
        select: { id: true, taxRuleId: true },
    });

    const warehouse = await prisma.warehouse.findFirst({ select: { id: true } });
    if (warehouse) {
        await prisma.stock.create({
            data: { productId: product.id, warehouseId: warehouse.id, quantity: 100 },
        });
    }

    const page = await prisma.landingPage.create({
        data: {
            title: `${PREFIX}page`,
            slug: `${PREFIX}page`,
            status: LandingPageStatus.PUBLISHED,
            productId: product.id,
            headline: "ডেস্টিনেশন",
            bodyHtml: "<p>x</p>",
            orderForm: {
                fields: {
                    fullName: { label: "নাম", required: true },
                    phone: { label: "মোবাইল" },
                    address: { label: "ঠিকানা" },
                },
                submitLabel: "অর্ডার",
            },
        },
        select: { id: true, slug: true },
    });

    /*
     * Captured so the `finally` puts the shop back exactly as it was. This
     * script writes to the SINGLETON settings row to prove the threshold
     * reaches a campaign, and a script that left a free-shipping threshold
     * behind would be giving away delivery on a real shop.
     */
    const originalThreshold = storeSetting.freeShippingThreshold;

    try {
        /* ---------------------------------------------------------------- *
         * 1. A served destination prices from the SHOP's option.
         * ---------------------------------------------------------------- */

        const quote = await LandingPageService.quoteLandingPageOrder(page.slug, {
            quantity: 1,
            deliveryOptionKey: servedOption.key,
        });

        check(
            "a campaign quote charges the shop option's STORED price",
            near(quote.shippingAmount, servedOption.price),
            `charged ${quote.shippingAmount}, option "${servedOption.key}" stores ${servedOption.price}`,
        );
        check(
            "the quote names the option it priced by",
            quote.deliveryOptionKey === servedOption.key &&
                quote.deliveryOptionLabel === servedOption.label,
            `key "${quote.deliveryOptionKey}", label "${quote.deliveryOptionLabel}"`,
        );

        /* ---------------------------------------------------------------- *
         * 2. THE TWO PATHS AGREE. (task 5.3)
         * ---------------------------------------------------------------- */

        /*
         * The same product, the same quantity, the same option, priced once
         * through the catalogue's quote and once through the campaign's. This
         * is the whole point of the change stated as a single equality: if
         * these two numbers ever differ again, there are two price lists live.
         */
        const shopQuote = await OrderService.quoteCheckout({ kind: "guest", ip: "127.0.0.1" } as never, {
            deliveryOptionKey: servedOption.key,
            items: [{ productId: product.id, quantity: 1 }],
        } as never);

        const shopShipping = Number((shopQuote as { shippingAmount: number }).shippingAmount);
        check(
            "the campaign and the catalogue charge the SAME delivery",
            near(quote.shippingAmount, shopShipping),
            `campaign ${quote.shippingAmount} vs shop ${shopShipping} — one price list, or two`,
        );

        const shopSubtotal = Number((shopQuote as { subtotal: number }).subtotal);
        check(
            "and reach the same subtotal for the same line",
            near(quote.subtotal, shopSubtotal),
            `campaign ${quote.subtotal} vs shop ${shopSubtotal}`,
        );

        /* ---------------------------------------------------------------- *
         * 3. An option the shop does not have is REFUSED, with no order made.
         * ---------------------------------------------------------------- */

        const beforeUnknown = await prisma.order.count({ where: { landingPageId: page.id } });

        const quoteRefusal = await thrownMessage(() =>
            LandingPageService.quoteLandingPageOrder(page.slug, {
                quantity: 1,
                deliveryOptionKey: "no-such-option",
            }),
        );
        check(
            "quoting an unknown option key is refused",
            quoteRefusal !== null,
            quoteRefusal ?? "it was priced — a campaign named an option the shop does not sell",
        );

        const placeRefusal = await thrownMessage(() =>
            LandingPageService.placeLandingPageOrder(
                { kind: "guest", ip: "127.0.0.1" } as never,
                page.slug,
                {
                    quantity: 1,
                    deliveryOptionKey: "no-such-option",
                    destination: { district: "Dhaka", area: "Mirpur" },
                    fullName: `${PREFIX}shopper`,
                    phone: PHONE,
                    address: "Test address",
                },
            ),
        );
        check(
            "placing against an unknown option key is refused",
            placeRefusal !== null,
            placeRefusal ?? "an order was created against an option that does not exist",
        );

        const afterUnknown = await prisma.order.count({ where: { landingPageId: page.id } });
        check(
            "and NO order was created by either refusal",
            afterUnknown === beforeUnknown,
            `${beforeUnknown} before, ${afterUnknown} after`,
        );

        /* ---------------------------------------------------------------- *
         * 4. A CLIENT-SUPPLIED DELIVERY AMOUNT IS NOT HONOURED.
         * ---------------------------------------------------------------- */

        /*
         * The payload is typed without any delivery-price field, so this is
         * cast past the type deliberately: the question is not whether TypeScript
         * refuses it — it is whether the SERVER does, for a request that never
         * went through TypeScript at all. A field the validator strips and the
         * service ignores is the answer; a field that reaches `quoteCharges` is
         * a shopper setting their own delivery charge.
         */
        const forged = await LandingPageService.quoteLandingPageOrder(page.slug, {
            quantity: 1,
            deliveryOptionKey: servedOption.key,
            shippingAmount: 0,
            deliveryPrice: 0,
            shippingOverride: { amount: 0, label: "free" },
        } as never);

        check(
            "a client-supplied delivery amount is ignored",
            near(forged.shippingAmount, servedOption.price),
            `charged ${forged.shippingAmount}, still the option's stored ${servedOption.price}`,
        );

        /* ---------------------------------------------------------------- *
         * 5. THE FREE-SHIPPING THRESHOLD NOW REACHES A CAMPAIGN. (task 2.3)
         * ---------------------------------------------------------------- */

        /*
         * The behaviour change design.md Decision 5 names, asserted rather than
         * described. A campaign order used to be charged through
         * `shippingOverride`, which bypassed both waivers by construction — a
         * campaign crossing the shop's free-delivery threshold was still
         * charged for delivery. It is not any more.
         *
         * Worth pinning BOTH directions: below the threshold the charge stands,
         * above it the charge is waived. A test that only checked the waiver
         * would pass just as well against a path that had stopped charging
         * delivery altogether.
         */
        await prisma.storeSetting.update({
            where: { id: "singleton" },
            data: { freeShippingThreshold: 100000 },
        });

        const underThreshold = await LandingPageService.quoteLandingPageOrder(page.slug, {
            quantity: 1,
            deliveryOptionKey: servedOption.key,
        });
        check(
            "below the threshold, a campaign still pays for delivery",
            near(underThreshold.shippingAmount, servedOption.price),
            `charged ${underThreshold.shippingAmount} on a subtotal of ${underThreshold.subtotal}`,
        );

        await prisma.storeSetting.update({
            where: { id: "singleton" },
            data: { freeShippingThreshold: 1 },
        });

        const overThreshold = await LandingPageService.quoteLandingPageOrder(page.slug, {
            quantity: 1,
            deliveryOptionKey: servedOption.key,
        });
        check(
            "ABOVE the threshold, a campaign gets free delivery",
            near(overThreshold.shippingAmount, 0),
            `charged ${overThreshold.shippingAmount} on a subtotal of ${overThreshold.subtotal} — this is the Decision 5 behaviour change, and it is deliberate`,
        );

        await prisma.storeSetting.update({
            where: { id: "singleton" },
            data: { freeShippingThreshold: originalThreshold },
        });

        /* ---------------------------------------------------------------- *
         * 6. THE DESTINATION IS RECORDED WHERE A SHOP ORDER PUTS IT.
         * ---------------------------------------------------------------- */

        const placed = await LandingPageService.quoteLandingPageOrder(page.slug, {
            quantity: 1,
            deliveryOptionKey: servedOption.key,
        });

        await LandingPageService.placeLandingPageOrder(
            { kind: "guest", ip: "127.0.0.1" } as never,
            page.slug,
            {
                quantity: 1,
                deliveryOptionKey: servedOption.key,
                destination: { district: "Dhaka", area: "Mirpur" },
                fullName: `${PREFIX}shopper`,
                phone: PHONE,
                address: "Test address",
                expectedTotal: placed.totalAmount,
            },
        );

        const order = await prisma.order.findFirst({
            where: { landingPageId: page.id },
            orderBy: { createdAt: "desc" },
            select: {
                shippingAmount: true,
                deliveryOptionKey: true,
                deliveryOptionLabel: true,
                shippingAddress: { select: { city: true, state: true } },
            },
        });

        check(
            "the order is charged the option's stored price",
            near(Number(order?.shippingAmount), servedOption.price),
            `charged ${Number(order?.shippingAmount)}, stored ${servedOption.price}`,
        );
        check(
            "the order names which option it was charged",
            order?.deliveryOptionKey === servedOption.key &&
                order?.deliveryOptionLabel === servedOption.label,
            `key "${order?.deliveryOptionKey}", label "${order?.deliveryOptionLabel}"`,
        );
        check(
            "the destination is in the columns a SHOP order uses",
            order?.shippingAddress?.state === "Dhaka" &&
                order?.shippingAddress?.city === "Mirpur",
            `state "${order?.shippingAddress?.state}", city "${order?.shippingAddress?.city}" — district in state, area in city, same as checkout`,
        );
    } finally {
        /*
         * The threshold FIRST, and outside the happy path: a check failing
         * between the two updates above would otherwise leave a live shop
         * giving away delivery on every order over ৳1.
         */
        await prisma.storeSetting.update({
            where: { id: "singleton" },
            data: { freeShippingThreshold: originalThreshold },
        });

        await prisma.order.deleteMany({ where: { landingPageId: page.id } });
        await prisma.landingPage.deleteMany({ where: { id: page.id } });
        await prisma.stock.deleteMany({ where: { productId: product.id } });
        await prisma.product.deleteMany({ where: { id: product.id } });
        await prisma.customer.deleteMany({ where: { phone: PHONE } });
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
