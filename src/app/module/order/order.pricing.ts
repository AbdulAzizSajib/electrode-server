import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { ChargeType } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { StoreSettingService } from "../store-setting/store-setting.service";

/**
 * Checkout pricing: what tax and delivery cost, given a set of lines and the
 * delivery option the shopper chose.
 *
 * Lives apart from order.service.ts because two callers need the same answer —
 * the checkout that commits the order, and the quote the storefront shows
 * before the shopper commits to it. A second implementation of "what does this
 * cost" is how a storefront ends up quoting one number and charging another.
 *
 * Delivery used to be MATCHED here, from the shopper's country and region
 * against a per-product rule's places, most specific first. It is now simply
 * LOOKED UP: the shopper picks an option and pays its price. See the
 * `commerce/delivery-options` spec, and design.md D3 for why the matcher went.
 */

/** Money is stored to 2dp; every intermediate is rounded the same way. */
export const roundMoney = (value: number) => Math.round(value * 100) / 100;

/** Whether the shopper is having it delivered or collecting it in person. */
export type DeliveryMethod = "DELIVERY" | "PICKUP";

/**
 * Enough of a checkout line to price it.
 *
 * Note what is no longer here: `shippingRuleId`. Delivery is a store-wide
 * choice the shopper makes, so nothing about the basket influences what it
 * costs — which is why delivery is now charged once per order rather than once
 * per distinct rule in it.
 */
export interface IPricingLine {
    productId: string;
    productName: string;
    quantity: number;
    /** Unit price times quantity, before any discount. */
    lineTotal: number;
    taxRuleId: string | null;
}

export interface ILineTax {
    productId: string;
    /** The line's share of the order discount, allocated by value. */
    discountShare: number;
    /** Tax charged on this line, on the amount actually being charged for it. */
    taxAmount: number;
}

export interface ITaxQuote {
    taxAmount: number;
    lines: ILineTax[];
}

/**
 * The delivery option the shopper chose, resolved against the store's settings.
 *
 * `label` is carried out of here so the order can capture it at placement — see
 * the spec's "The order records which option was chosen". Resolving it server
 * side rather than trusting a label from the request body is what stops a
 * client naming its own price.
 */
export interface IDeliveryQuote {
    optionKey: string;
    optionLabel: string;
    method: DeliveryMethod;
    /** The option's price, before any free-delivery waiver. */
    price: number;
    days: number;
}

/**
 * Splits `discountAmount` across the lines in proportion to what each is worth.
 *
 * A coupon discounts the order, but tax is charged per product by that
 * product's own rule — so the discount has to land on specific lines before any
 * rule can be applied to "the price actually charged". Proportional by value is
 * the only split that leaves every line taxed on the same fraction of its price.
 *
 * The last line absorbs the rounding remainder, so the shares always sum to
 * exactly the discount rather than to a cent less.
 */
const allocateDiscount = (lines: IPricingLine[], discountAmount: number): number[] => {
    const shares = lines.map(() => 0);

    if (discountAmount <= 0) return shares;

    const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
    if (subtotal <= 0) return shares;

    // A discount larger than the order would produce negative taxable amounts.
    const capped = Math.min(discountAmount, subtotal);

    let allocated = 0;
    for (let i = 0; i < lines.length - 1; i += 1) {
        const share = roundMoney((lines[i].lineTotal / subtotal) * capped);
        shares[i] = share;
        allocated += share;
    }
    shares[lines.length - 1] = roundMoney(capped - allocated);

    return shares;
};

/**
 * Tax on every line, each by its own product's rule.
 *
 * A percentage applies to the line total *after* its share of the discount, so
 * a discounted product is taxed on what the shopper actually pays for it. A
 * flat rule charges its amount per unit — a fixed tax on a product is a tax on
 * each one bought, not on the line.
 *
 * A product with NO rule assigned is untaxed. Tax Rules are the only source of
 * tax on an order (`store-config/tax-configuration`), so an untagged product
 * contributing nothing is the answer, not a gap to fill from elsewhere.
 *
 * This replaced a shop-wide `fallbackPercent` read from
 * `StoreSetting.defaultTaxRatePercent`, which predated Tax Rules. Keeping both
 * meant a merchant who had moved to Tax Rules still had a second, half-forgotten
 * rate quietly taxing anything they had not yet tagged — invisible from the Tax
 * Rules screen that was supposed to be the answer. The parameter was removed
 * rather than defaulted to zero, so the hole cannot be refilled by accident.
 */
export const quoteTax = async (
    lines: IPricingLine[],
    discountAmount: number,
): Promise<ITaxQuote> => {
    const ruleIds = [...new Set(lines.map((l) => l.taxRuleId).filter((id): id is string => !!id))];

    const rules = ruleIds.length
        ? await prisma.taxRule.findMany({ where: { id: { in: ruleIds } } })
        : [];
    const ruleById = new Map(rules.map((rule) => [rule.id, rule]));

    const shares = allocateDiscount(lines, discountAmount);

    const lineTaxes = lines.map((line, index) => {
        const discountShare = shares[index];
        const taxable = Math.max(0, line.lineTotal - discountShare);
        const rule = line.taxRuleId ? ruleById.get(line.taxRuleId) : undefined;

        let taxAmount: number;
        if (!rule) {
            // No rule, no tax. See the note above the function.
            taxAmount = 0;
        } else if (rule.type === ChargeType.FLAT) {
            taxAmount = roundMoney(Number(rule.value) * line.quantity);
        } else {
            taxAmount = roundMoney((taxable * Number(rule.value)) / 100);
        }

        return { productId: line.productId, discountShare, taxAmount };
    });

    return {
        taxAmount: roundMoney(lineTaxes.reduce((sum, l) => sum + l.taxAmount, 0)),
        lines: lineTaxes,
    };
};

/**
 * The delivery option the shopper chose, resolved and priced.
 *
 * Everything about this is a lookup by key. Nothing is derived from the address
 * the shopper typed, nothing depends on what is in the basket, and delivery is
 * charged ONCE — the per-rule grouping this replaced summed a charge per
 * distinct shipping rule in the order.
 *
 * The three throws are the three ways a submitted key can be wrong, and they
 * are deliberately different from one another:
 *
 *   - the store has no options at all: a merchant has not set delivery up.
 *     Named as a store problem, because the shopper can do nothing about it.
 *   - the key names no option: the shopper's page is stale — the option was
 *     deleted or renamed away underneath them. They are asked to choose again
 *     rather than charged a stale price.
 *   - the key names a pickup point while collection is switched off: a request
 *     replayed against a setting the merchant has since turned off. Checked
 *     here and not only in the storefront, so switching it off actually closes
 *     the door.
 */
export const quoteDelivery = async (optionKey: string): Promise<IDeliveryQuote> => {
    const { delivery } = await StoreSettingService.getCheckoutConfig();

    if (delivery.options.length === 0) {
        throw new AppError(
            status.BAD_REQUEST,
            "This store has not set up delivery yet, so orders cannot be placed. Please contact the store.",
        );
    }

    const option = delivery.options.find((o) => o.key === optionKey);

    if (!option) {
        throw new AppError(
            status.BAD_REQUEST,
            "That delivery option is no longer available — please choose again.",
        );
    }

    if (option.kind === "PICKUP" && !delivery.offersPickup) {
        throw new AppError(
            status.BAD_REQUEST,
            "Collection in person is not being offered — please choose a delivery option.",
        );
    }

    return {
        optionKey: option.key,
        optionLabel: option.label,
        method: option.kind,
        price: roundMoney(option.price),
        days: option.days,
    };
};

/**
 * A delivery charge decided somewhere other than by the store's own options.
 *
 * Exists for exactly one caller: a campaign landing page, which offers its own
 * delivery zones (`ঢাকার ভিতরে ৳60` / `ঢাকার বাইরে ৳120`) and states a charge
 * on the page before the shopper has typed an address. It cannot go through
 * `quoteDelivery` because those zones are the PAGE's, authored per campaign —
 * and because a landing page must work whether or not the merchant has
 * configured delivery for the rest of the shop.
 *
 * `amount` is read from the page's stored zone, never from the request body.
 * `label` travels with it only so the resulting order can say which area was
 * chosen.
 */
export interface IShippingOverride {
    amount: number;
    label: string;
}

export interface IChargeQuoteInput {
    lines: IPricingLine[];
    discountAmount: number;
    /**
     * Which delivery option the shopper chose. Required on the normal path —
     * the shopper picks it, nothing infers it — and unused when
     * `shippingOverride` is set, since a landing page prices its own zones.
     */
    deliveryOptionKey?: string;
    /** From an applied coupon. Waives delivery, never collection. */
    couponWaivesShipping: boolean;
    /** Threshold above which delivery is free, or null when the shop has none. */
    freeShippingThreshold: number | null;
    /**
     * When set, delivery costs this and `quoteDelivery` is not consulted at all.
     * See IShippingOverride, and `quoteCharges` below for why no waiver applies
     * to it.
     */
    shippingOverride?: IShippingOverride;
}

export interface IChargeQuote {
    subtotal: number;
    taxAmount: number;
    shippingAmount: number;
    /** What delivery would cost before any waiver, for showing the shopper why it is free. */
    shippingBeforeWaiver: number;
    deliveryDays: number | null;
    tax: ITaxQuote;
    /** The resolved option, for the order to capture. Null on the override path. */
    delivery: IDeliveryQuote | null;
}

/**
 * Both charges in one call, which is what every caller actually wants.
 *
 * Free shipping — from a coupon or from the shop's order-value threshold —
 * waives *delivery* only. A shopper who chooses to collect in person is
 * choosing a different service, and its price is what that place charges for
 * it; zeroing it because delivery happened to be free would give away a
 * collection fee nobody waived.
 *
 * An overridden delivery charge (see IShippingOverride) short-circuits before
 * any of that. Tax is still charged by each product's own rule — an override is
 * a statement about delivery, not about tax — but NEITHER waiver applies:
 *
 *   - the shop's order-value threshold, because the landing page printed
 *     "ডেলিভারি চার্জ ৳60" beside the order button and the shopper agreed to
 *     that number. Zeroing it because an unrelated shop-wide threshold happened
 *     to be crossed would make the page a liar in the shopper's favour and the
 *     merchant's expense, on an order the merchant never quoted that way.
 *   - a coupon's free-shipping flag, which is moot here (a landing page has no
 *     coupon box) and is closed explicitly so it stays moot.
 *
 * `quoteDelivery` is not called at all on this path — not called and its result
 * discarded. It throws when the shop has no delivery options, and a landing page
 * must work whether or not the merchant has configured delivery for the rest of
 * the shop.
 */
export const quoteCharges = async (input: IChargeQuoteInput): Promise<IChargeQuote> => {
    const subtotal = roundMoney(input.lines.reduce((sum, line) => sum + line.lineTotal, 0));

    if (input.shippingOverride) {
        const tax = await quoteTax(input.lines, input.discountAmount);
        const amount = roundMoney(input.shippingOverride.amount);

        return {
            subtotal,
            taxAmount: tax.taxAmount,
            shippingAmount: amount,
            // Equal by construction: nothing waives an overridden charge, so
            // there is no "before" that differs from the "after".
            shippingBeforeWaiver: amount,
            deliveryDays: null,
            tax,
            // The page's zone is not one of the store's options, so there is no
            // option to report. Null is the honest answer, not a gap — and it is
            // what keeps a landing-page order out of the option's order counts.
            delivery: null,
        };
    }

    if (!input.deliveryOptionKey) {
        throw new AppError(status.BAD_REQUEST, "Please choose a delivery option");
    }

    const [tax, delivery] = await Promise.all([
        quoteTax(input.lines, input.discountAmount),
        quoteDelivery(input.deliveryOptionKey),
    ]);

    /*
     * A waiver frees DELIVERY, never collection. A shopper collecting in person
     * is choosing a different service, and its price is what the merchant set
     * for it; zeroing it because delivery happened to be free would give away a
     * collection fee nobody waived.
     */
    const meetsThreshold =
        input.freeShippingThreshold !== null && subtotal >= input.freeShippingThreshold;
    const waived =
        delivery.method === "DELIVERY" && (input.couponWaivesShipping || meetsThreshold);

    return {
        subtotal,
        taxAmount: tax.taxAmount,
        shippingAmount: waived ? 0 : delivery.price,
        shippingBeforeWaiver: delivery.price,
        deliveryDays: delivery.days,
        tax,
        delivery,
    };
};
