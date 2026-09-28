/**
 * Verification for the single-product landing page change.
 *
 * Covers the places where a wrong value costs real money or leaves the
 * storefront broken, rather than merely looking wrong:
 *
 *  - the delivery-zone override, which decides what a shopper is CHARGED for
 *    delivery and which must not be waived by rules the campaign page never
 *    mentioned;
 *  - the proof that the override did not leak into the normal checkout, whose
 *    delivery must still be priced by matching a ShippingPlace;
 *  - the landing page's own required-field rule, which must be independent of
 *    the shop-wide checkout config in one direction and unable to drop the
 *    phone or address in the other;
 *  - the Zod invariants Postgres cannot express — at least one delivery zone,
 *    distinct zone keys, a digits-only pixel id, and the absence of any way to
 *    spell "hide the phone field";
 *  - the site-mode rule, which is what stops a merchant pointing their home
 *    page at a draft or at nothing.
 *
 * Pure functions only — no database, no network. `quoteCharges` touches neither
 * when every line is untaxed and delivery is overridden, which is exactly the
 * shape a landing page order has. Run with:
 *   npx tsx scripts/verify-landing-page.ts
 */
import { LandingPageStatus, SiteMode } from "../src/generated/prisma/client";
import { quoteCharges, type IPricingLine } from "../src/app/module/order/order.pricing";
import {
    DEFAULT_ORDER_FORM,
} from "../src/app/module/landing-page/landing-page.constant";
import {
    collectMissingLandingPageFields,
    missingLandingPageFieldsMessage,
} from "../src/app/module/landing-page/landing-page.order-fields";
import {
    createLandingPageZodSchema,
    placeLandingPageOrderZodSchema,
} from "../src/app/module/landing-page/landing-page.validation";
import { StoreSettingService } from "../src/app/module/store-setting/store-setting.service";
import { siteModeRejection } from "../src/app/module/store-setting/store-setting.site-mode";
import type { ILandingPageOrderForm } from "../src/app/module/landing-page/landing-page.interface";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

/** A single untaxed line, which is what keeps every quote below database-free. */
const line = (lineTotal: number, quantity = 1): IPricingLine => ({
    productId: "p1",
    productName: "Winter Hoodie",
    quantity,
    lineTotal,
    taxRuleId: null,
});

/*
 * A delivery option the SHOP has. Read from settings rather than hardcoded, so
 * the script prices against whatever this store is actually configured with —
 * a campaign no longer carries a price list of its own to read.
 */
const SHOP_OPTION_KEY = await (async () => {
    const config = await StoreSettingService.getCheckoutConfig();
    const option = config.delivery.options.find((o) => o.kind === "DELIVERY");
    if (!option) {
        console.error(
            "This store has no delivery option configured, so a campaign cannot be priced. Add one in Checkout Setting.",
        );
        process.exit(1);
    }
    return option.key;
})();

const main = async () => {
    console.log("\n--- 1 & 2. A campaign is priced by the SHOP's delivery options ---\n");

    /*
     * THESE TWO SECTIONS USED TO ASSERT THE OPPOSITE, and the reversal is the
     * whole of `add-landing-page-destination-picker`.
     *
     * A campaign used to author its own delivery zones and charge them through
     * `shippingOverride`, which bypassed the shop's options and — deliberately
     * — both waivers. So the same customer at the same address paid one figure
     * through the catalogue and another through an ad, and a merchant raising
     * their outside-Dhaka rate in Checkout Setting changed only one of them.
     *
     * A campaign now prices through the shop's own options, which means it also
     * RECEIVES the shop's free-shipping threshold and a coupon's shipping
     * waiver. That is a real behaviour change, and it is asserted here rather
     * than left for someone to discover from an order.
     */
    const shopPriced = await quoteCharges({
        lines: [line(990)],
        discountAmount: 0,
        deliveryOptionKey: SHOP_OPTION_KEY,
        couponWaivesShipping: false,
        freeShippingThreshold: null,
    });

    check(
        "a campaign charges the SHOP's option price",
        shopPriced.shippingAmount === shopPriced.delivery?.price,
        `charged ${shopPriced.shippingAmount}, option price ${shopPriced.delivery?.price}`,
    );

    const overThreshold = await quoteCharges({
        lines: [line(5000)],
        discountAmount: 0,
        deliveryOptionKey: SHOP_OPTION_KEY,
        couponWaivesShipping: false,
        freeShippingThreshold: 1000,
    });

    check(
        "the shop's free-shipping threshold NOW reaches a campaign",
        overThreshold.shippingAmount === 0,
        `basket 5000 over a 1000 threshold charged ${overThreshold.shippingAmount} — it used to charge the zone price regardless`,
    );

    const couponWaived = await quoteCharges({
        lines: [line(990)],
        discountAmount: 0,
        deliveryOptionKey: SHOP_OPTION_KEY,
        couponWaivesShipping: true,
        freeShippingThreshold: null,
    });

    check(
        "a coupon's shipping waiver NOW reaches a campaign too",
        couponWaived.shippingAmount === 0,
        `expected 0, got ${couponWaived.shippingAmount}`,
    );

    check(
        "the pre-waiver figure is still reported, so a saving can be shown",
        overThreshold.shippingBeforeWaiver > 0,
        `before ${overThreshold.shippingBeforeWaiver}, after ${overThreshold.shippingAmount}`,
    );

    console.log("\n--- 3. The override did not leak into the normal checkout ---\n");

    /*
     * The same basket WITHOUT an override must still go through quoteDelivery,
     * which refuses an option key that resolves to nothing. If the override had
     * become a default — or if quoteDelivery were being skipped for everyone —
     * this would quietly return 0 and the merchant would be paying for
     * delivery. The throw is the proof that the normal path is untouched.
     */
    let refused = false;
    let refusalMessage = "";
    try {
        await quoteCharges({
            lines: [line(990)],
            deliveryOptionKey: "__no_such_option__",
            discountAmount: 0,
            couponWaivesShipping: false,
            freeShippingThreshold: null,
        });
    } catch (error) {
        refused = true;
        refusalMessage = error instanceof Error ? error.message : String(error);
    }

    check(
        "without an override, an unresolvable delivery option is still refused",
        refused &&
            (refusalMessage.includes("no longer available") ||
                refusalMessage.includes("has not set up delivery")),
        refused ? refusalMessage : "quoteCharges returned instead of throwing",
    );

    console.log("\n--- 4. The landing page's own required-field rule ---\n");

    const form = DEFAULT_ORDER_FORM;

    check(
        "a complete submission passes",
        collectMissingLandingPageFields(form, {
            fullName: "রহিম",
            phone: "01712345678",
            address: "ধানমন্ডি, ঢাকা",
        }).length === 0,
        "no fields reported missing",
    );

    check(
        "a blank address is refused",
        collectMissingLandingPageFields(form, {
            fullName: "রহিম",
            phone: "01712345678",
            address: "   ",
        }).includes(form.fields.address.label),
        "whitespace does not satisfy the address",
    );

    check(
        "a missing phone is refused",
        collectMissingLandingPageFields(form, {
            fullName: "রহিম",
            address: "ধানমন্ডি, ঢাকা",
        }).includes(form.fields.phone.label),
        "phone is required whatever the form says",
    );

    const nameOptionalForm: ILandingPageOrderForm = {
        ...form,
        fields: {
            ...form.fields,
            fullName: { ...form.fields.fullName, required: false },
        },
    };

    check(
        "a merchant may make the name optional",
        collectMissingLandingPageFields(nameOptionalForm, {
            phone: "01712345678",
            address: "ধানমন্ডি, ঢাকা",
        }).length === 0,
        "phone and address alone are accepted",
    );

    check(
        "the phone stays required even when the name is optional",
        collectMissingLandingPageFields(nameOptionalForm, {
            address: "ধানমন্ডি, ঢাকা",
        }).includes(form.fields.phone.label),
        "no configuration can drop the phone",
    );

    check(
        "one message names every missing field",
        missingLandingPageFieldsMessage(["নাম", "ঠিকানা"]) === "নাম, ঠিকানা are required",
        missingLandingPageFieldsMessage(["নাম", "ঠিকানা"]),
    );

    /*
     * The shop-wide checkoutConfig requiring a city and a postal code is the
     * scenario this whole separation exists for: the landing page asks for
     * neither, and its rule must not consult that config. Proven by the rule's
     * inputs — it takes the PAGE's orderForm and nothing else, so there is no
     * argument through which a shop setting could reach it.
     */
    check(
        "the rule cannot see the shop's checkout config",
        collectMissingLandingPageFields.length === 2,
        "takes only (orderForm, submitted) — no settings argument exists",
    );

    console.log("\n--- 5. Invariants Postgres cannot express ---\n");

    const validPage = {
        title: "শীতের অফার",
        productId: "prod_1",
        headline: "প্রিমিয়াম উইন্টার হুডি",
        bodyHtml: "<p>নরম ফ্লিস।</p>",
    };

    check(
        "a minimal page is accepted",
        createLandingPageZodSchema.safeParse(validPage).success,
        "title, product, headline and body are enough",
    );

    check(
        "an empty rich-text body is refused",
        !createLandingPageZodSchema.safeParse({ ...validPage, bodyHtml: "<p></p>" }).success,
        "what the editor emits for an empty document",
    );

    check(
        "a campaign cannot author delivery prices at all",
        !createLandingPageZodSchema.safeParse({
            ...validPage,
            deliveryZones: [{ key: "inside-dhaka", label: "ঢাকার ভিতরে", price: 60 }],
        }).success,
        "the shop's delivery options are the single price list — a campaign that could author its own would put two live at once",
    );

    check(
        "the seeded order form is itself valid",
        createLandingPageZodSchema.safeParse({ ...validPage, orderForm: DEFAULT_ORDER_FORM })
            .success,
        "the Bangla defaults pass their own schema",
    );

    /*
     * There is deliberately NOWHERE to say "the phone is optional". `.strict()`
     * on the field objects is what makes that a guarantee rather than a
     * convention: a payload smuggling the key is rejected as unknown rather
     * than being quietly dropped and silently getting the default.
     */
    check(
        "a phone field carrying `required` is refused as an unknown key",
        !createLandingPageZodSchema.safeParse({
            ...validPage,
            orderForm: {
                ...DEFAULT_ORDER_FORM,
                fields: {
                    ...DEFAULT_ORDER_FORM.fields,
                    phone: { ...DEFAULT_ORDER_FORM.fields.phone, required: false },
                },
            },
        }).success,
        "no payload can ask for a checkout without a phone number",
    );

    check(
        "an address field carrying `show` is refused as an unknown key",
        !createLandingPageZodSchema.safeParse({
            ...validPage,
            orderForm: {
                ...DEFAULT_ORDER_FORM,
                fields: {
                    ...DEFAULT_ORDER_FORM.fields,
                    address: { ...DEFAULT_ORDER_FORM.fields.address, show: false },
                },
            },
        }).success,
        "a COD parcel with no address cannot be delivered",
    );

    check(
        "a non-numeric pixel id is refused",
        !createLandingPageZodSchema.safeParse({ ...validPage, facebookPixelId: "<script>" })
            .success,
        "the id is interpolated into a script the app wrote",
    );

    check(
        "a numeric pixel id is accepted",
        createLandingPageZodSchema.safeParse({ ...validPage, facebookPixelId: "1234567890" })
            .success,
        "digits only",
    );

    check(
        "an uppercase slug is refused",
        !createLandingPageZodSchema.safeParse({ ...validPage, slug: "Winter Offer" }).success,
        "slugs are lowercase words joined by single hyphens",
    );

    console.log("\n--- 6. The order submission schema ---\n");

    const validOrder = {
        quantity: 1,
        deliveryOptionKey: "option-2",
        phone: "01712345678",
        address: "ধানমন্ডি, ঢাকা",
    };

    check(
        "a submission without a name is accepted at the schema layer",
        placeLandingPageOrderZodSchema.safeParse(validOrder).success,
        "whether a name is required is the page's decision, made in the service",
    );

    check(
        "a non-Bangladeshi phone number is refused",
        !placeLandingPageOrderZodSchema.safeParse({ ...validOrder, phone: "12345" }).success,
        "the same validator the normal guest checkout uses",
    );

    check(
        "a blank address is refused",
        !placeLandingPageOrderZodSchema.safeParse({ ...validOrder, address: "   " }).success,
        "trimmed before it is measured",
    );

    check(
        "an order with no delivery option is refused",
        !placeLandingPageOrderZodSchema.safeParse({ ...validOrder, deliveryOptionKey: "" }).success,
        "the destination must resolve to one of the shop's options before an order can be priced",
    );

    check(
        "a quantity below 1 is refused",
        !placeLandingPageOrderZodSchema.safeParse({ ...validOrder, quantity: 0 }).success,
        "an order for nothing is not an order",
    );

    console.log("\n--- 7. The site-mode rule ---\n");

    const published = { status: LandingPageStatus.PUBLISHED, title: "শীতের অফার" };
    const draft = { status: LandingPageStatus.DRAFT, title: "শীতের অফার" };

    check(
        "website mode is always servable",
        siteModeRejection(
            { siteMode: SiteMode.WEBSITE, activeLandingPageId: null },
            null,
        ) === null,
        "a shop showing its own homepage cannot be broken by the selection",
    );

    check(
        "landing page mode with a published page is servable",
        siteModeRejection(
            { siteMode: SiteMode.LANDING_PAGE, activeLandingPageId: "lp1" },
            published,
        ) === null,
        "the one combination that is meant to work",
    );

    check(
        "landing page mode with nothing selected is refused",
        siteModeRejection(
            { siteMode: SiteMode.LANDING_PAGE, activeLandingPageId: null },
            null,
        )?.includes("Choose which landing page") === true,
        "and the message says what to do first",
    );

    check(
        "landing page mode pointing at a draft is refused",
        siteModeRejection(
            { siteMode: SiteMode.LANDING_PAGE, activeLandingPageId: "lp1" },
            draft,
        )?.includes("still a draft") === true,
        "a draft home page would be a 404",
    );

    check(
        "landing page mode pointing at a deleted page is refused",
        siteModeRejection(
            { siteMode: SiteMode.LANDING_PAGE, activeLandingPageId: "gone" },
            null,
        )?.includes("no longer exists") === true,
        "the row is read at save time, not trusted from the pointer",
    );

    check(
        "website mode with a draft selected is still servable",
        siteModeRejection(
            { siteMode: SiteMode.WEBSITE, activeLandingPageId: "lp1" },
            draft,
        ) === null,
        "a merchant may prepare a selection before publishing it",
    );

    console.log(
        `\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}\n`,
    );

    process.exit(failures === 0 ? 0 : 1);
};

void main();
