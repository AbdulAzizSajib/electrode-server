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
    DEFAULT_DELIVERY_ZONES,
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
    shippingRuleId: null,
});

const INSIDE = DEFAULT_DELIVERY_ZONES[0];
const OUTSIDE = DEFAULT_DELIVERY_ZONES[1];

const main = async () => {
    console.log("\n--- 1. The zone price is what gets charged ---\n");

    const insideQuote = await quoteCharges({
        lines: [line(990)],
        destination: {},
        discountAmount: 0,
        deliveryMethod: "DELIVERY",
        couponWaivesShipping: false,
        freeShippingThreshold: null,
        shippingOverride: { amount: INSIDE.price, label: INSIDE.label },
    });

    check(
        "inside-Dhaka zone charges its own price",
        insideQuote.shippingAmount === 60,
        `expected 60, got ${insideQuote.shippingAmount}`,
    );

    const outsideQuote = await quoteCharges({
        lines: [line(990)],
        destination: {},
        discountAmount: 0,
        deliveryMethod: "DELIVERY",
        couponWaivesShipping: false,
        freeShippingThreshold: null,
        shippingOverride: { amount: OUTSIDE.price, label: OUTSIDE.label },
    });

    check(
        "outside-Dhaka zone charges its own price",
        outsideQuote.shippingAmount === 120,
        `expected 120, got ${outsideQuote.shippingAmount}`,
    );

    check(
        "the two zones charge different amounts for the same basket",
        insideQuote.shippingAmount !== outsideQuote.shippingAmount,
        `${insideQuote.shippingAmount} vs ${outsideQuote.shippingAmount}`,
    );

    const freeZone = await quoteCharges({
        lines: [line(990)],
        destination: {},
        discountAmount: 0,
        deliveryMethod: "DELIVERY",
        couponWaivesShipping: false,
        freeShippingThreshold: null,
        shippingOverride: { amount: 0, label: "ফ্রি ডেলিভারি" },
    });

    check(
        "a zone priced 0 is free delivery, and is spellable",
        freeZone.shippingAmount === 0,
        `expected 0, got ${freeZone.shippingAmount}`,
    );

    console.log("\n--- 2. Nothing waives an overridden delivery charge ---\n");

    // The whole point: the page printed "ডেলিভারি চার্জ ৳60" beside the order
    // button. An unrelated shop-wide threshold must not silently zero it.
    const overThreshold = await quoteCharges({
        lines: [line(5000)],
        destination: {},
        discountAmount: 0,
        deliveryMethod: "DELIVERY",
        couponWaivesShipping: false,
        freeShippingThreshold: 1000,
        shippingOverride: { amount: INSIDE.price, label: INSIDE.label },
    });

    check(
        "the shop's free-shipping threshold does NOT waive a zone charge",
        overThreshold.shippingAmount === 60,
        `basket 5000 over a 1000 threshold still charged ${overThreshold.shippingAmount}`,
    );

    const couponWaived = await quoteCharges({
        lines: [line(990)],
        destination: {},
        discountAmount: 0,
        deliveryMethod: "DELIVERY",
        couponWaivesShipping: true,
        freeShippingThreshold: null,
        shippingOverride: { amount: INSIDE.price, label: INSIDE.label },
    });

    check(
        "a coupon's free-shipping flag does NOT waive a zone charge",
        couponWaived.shippingAmount === 60,
        `expected 60, got ${couponWaived.shippingAmount}`,
    );

    check(
        "shippingBeforeWaiver equals the charge, because nothing waives it",
        overThreshold.shippingBeforeWaiver === overThreshold.shippingAmount,
        `${overThreshold.shippingBeforeWaiver} vs ${overThreshold.shippingAmount}`,
    );

    check(
        "no ShippingPlace is reported as matched under an override",
        overThreshold.shipping.matches.length === 0 && overThreshold.pickupAmount === null,
        `matches=${overThreshold.shipping.matches.length}, pickup=${overThreshold.pickupAmount}`,
    );

    console.log("\n--- 3. The override did not leak into the normal checkout ---\n");

    /*
     * The same basket WITHOUT an override must still go through quoteShipping,
     * which refuses a line carrying no shipping rule. If the override had
     * become a default — or if quoteShipping were being skipped for everyone —
     * this would quietly return 0 and the merchant would be paying for
     * delivery. The throw is the proof that the normal path is untouched.
     */
    let refused = false;
    let refusalMessage = "";
    try {
        await quoteCharges({
            lines: [line(990)],
            destination: {},
            discountAmount: 0,
            deliveryMethod: "DELIVERY",
            couponWaivesShipping: false,
            freeShippingThreshold: null,
        });
    } catch (error) {
        refused = true;
        refusalMessage = error instanceof Error ? error.message : String(error);
    }

    check(
        "without an override, a line with no shipping rule is still refused",
        refused && refusalMessage.includes("cannot be delivered"),
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
        "an empty delivery zone list is refused",
        !createLandingPageZodSchema.safeParse({ ...validPage, deliveryZones: [] }).success,
        "a page matching no zone can charge no delivery",
    );

    check(
        "duplicate zone keys are refused",
        !createLandingPageZodSchema.safeParse({
            ...validPage,
            deliveryZones: [
                { key: "dhaka", label: "ঢাকার ভিতরে", price: 60 },
                { key: "dhaka", label: "ঢাকার বাইরে", price: 120 },
            ],
        }).success,
        "which price is charged must not depend on array order",
    );

    check(
        "a negative zone price is refused",
        !createLandingPageZodSchema.safeParse({
            ...validPage,
            deliveryZones: [{ key: "dhaka", label: "ঢাকার ভিতরে", price: -60 }],
        }).success,
        "a discount hidden inside a shipping field",
    );

    check(
        "the seeded zones are themselves valid",
        createLandingPageZodSchema.safeParse({
            ...validPage,
            deliveryZones: DEFAULT_DELIVERY_ZONES,
        }).success,
        "the Bangla defaults pass their own schema",
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
        zoneKey: "inside-dhaka",
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
        "a missing zone is refused",
        !placeLandingPageOrderZodSchema.safeParse({ ...validOrder, zoneKey: "" }).success,
        "the shopper must choose a delivery area",
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
