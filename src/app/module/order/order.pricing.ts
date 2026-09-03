import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { ChargeType } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";

/**
 * Checkout pricing: what tax and delivery cost, given a set of lines and where
 * they are going.
 *
 * Lives apart from order.service.ts because two callers need the same answer —
 * the checkout that commits the order, and the quote the storefront shows
 * before the shopper commits to it. A second implementation of "what does this
 * cost" is how a storefront ends up quoting one number and charging another.
 *
 * See align-admin-catalog-with-reference — design.md, "Shipping matches
 * most-specific-first", and the `admin/catalog-rules` spec.
 */

/** Money is stored to 2dp; every intermediate is rounded the same way. */
export const roundMoney = (value: number) => Math.round(value * 100) / 100;

/** Whether the shopper is having it delivered or collecting it in person. */
export type DeliveryMethod = "DELIVERY" | "PICKUP";

/** Enough of a checkout line to price it. */
export interface IPricingLine {
    productId: string;
    productName: string;
    quantity: number;
    /** Unit price times quantity, before any discount. */
    lineTotal: number;
    taxRuleId: string | null;
    shippingRuleId: string | null;
}

export interface IDestination {
    country?: string | null;
    state?: string | null;
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

export interface IShippingQuote {
    /** Charged when the order is delivered. */
    deliveryAmount: number;
    /** Charged instead when the shopper collects, or null when nobody offers it. */
    pickupAmount: number | null;
    /** Longest delivery time among the matched places, for the shopper to see. */
    deliveryDays: number | null;
    /** The matched place per shipping rule, for display and for the audit trail. */
    matches: {
        shippingRuleId: string;
        placeId: string;
        placeName: string | null;
        price: number;
        deliveryDays: number;
        offersPickup: boolean;
        pickupPrice: number;
    }[];
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
 * `fallbackPercent` covers a product with no rule assigned. `Product.taxRuleId`
 * is nullable (rows predate the column; the migration backfilled them and the
 * product service requires one), so this path should not be reachable — but if
 * it is, the shop-wide rate that applied before this change is the answer that
 * does not change what a shopper is charged.
 */
export const quoteTax = async (
    lines: IPricingLine[],
    discountAmount: number,
    fallbackPercent: number,
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
            taxAmount = roundMoney((taxable * fallbackPercent) / 100);
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
 * The place in `places` covering `destination`, most specific first.
 *
 * Region beats country beats catch-all. Without that order two places covering
 * the same shopper are a coin toss, and a merchant adding a specific rate would
 * see it ignored at random.
 *
 * Matching is case-insensitive on both parts: an address typed "dhaka" and a
 * place authored "Dhaka" are the same place, and a shopper should not be told
 * their address is undeliverable over a capital letter.
 */
export const matchPlace = <T extends { country: string | null; state: string | null }>(
    places: T[],
    destination: IDestination,
): T | null => {
    const country = destination.country?.trim().toLowerCase() || null;
    const state = destination.state?.trim().toLowerCase() || null;

    /** `authored` comes from the place; `wanted` is already normalised. */
    const same = (authored: string | null, wanted: string) =>
        (authored ?? "").trim().toLowerCase() === wanted;

    return (
        (country && state
            ? places.find((p) => p.state && same(p.country, country) && same(p.state, state))
            : undefined) ??
        (country ? places.find((p) => !p.state && same(p.country, country)) : undefined) ??
        places.find((p) => !p.country && !p.state) ??
        null
    );
};

/**
 * What delivery costs for these lines to this destination.
 *
 * Charged once per distinct shipping rule in the order, not once per product: a
 * rule is a delivery policy, and three products under the same policy travel in
 * the same parcel. Two products under *different* policies genuinely cost two
 * different deliveries, so those add up — charging only the dearer would give
 * one away.
 *
 * A product with no shipping rule rides along on whatever else is being
 * delivered rather than being charged separately; an order made entirely of
 * such products falls back to the flat `ShippingMethod` price the shopper
 * picked, which is what they were charged before this change.
 *
 * Throws when a rule covers nothing at this destination. A destination nobody
 * can deliver to must be said out loud — quietly charging zero for it is a
 * delivery the merchant pays for.
 */
export const quoteShipping = async (
    lines: IPricingLine[],
    destination: IDestination,
    fallbackFlatPrice: number,
): Promise<IShippingQuote> => {
    const ruleIds = [
        ...new Set(lines.map((l) => l.shippingRuleId).filter((id): id is string => !!id)),
    ];

    if (ruleIds.length === 0) {
        return {
            deliveryAmount: roundMoney(fallbackFlatPrice),
            pickupAmount: null,
            deliveryDays: null,
            matches: [],
        };
    }

    const rules = await prisma.shippingRule.findMany({
        where: { id: { in: ruleIds } },
        include: { places: true },
    });
    const ruleById = new Map(rules.map((rule) => [rule.id, rule]));

    const where =
        [destination.state, destination.country].filter(Boolean).join(", ") || "that destination";

    const matches: IShippingQuote["matches"] = [];

    for (const ruleId of ruleIds) {
        const rule = ruleById.get(ruleId);
        if (!rule) {
            throw new AppError(status.CONFLICT, "A product's delivery options are unavailable");
        }

        const place = matchPlace(rule.places, destination);

        if (!place) {
            // Name the product, not the rule: a shopper has never heard of
            // "Standard delivery" but knows what they put in their basket.
            const product = lines.find((l) => l.shippingRuleId === ruleId);
            throw new AppError(
                status.BAD_REQUEST,
                `"${product?.productName ?? "One of your items"}" cannot be delivered to ${where}`,
            );
        }

        matches.push({
            shippingRuleId: ruleId,
            placeId: place.id,
            placeName: place.name,
            price: Number(place.price),
            deliveryDays: place.deliveryDays,
            offersPickup: place.offersPickup,
            pickupPrice: Number(place.pickupPrice),
        });
    }

    // Collection is offered only when every matched place offers it — an order
    // half of which still has to be delivered is not an order the shopper can
    // collect.
    const everyPlaceOffersPickup = matches.every((m) => m.offersPickup);

    return {
        deliveryAmount: roundMoney(matches.reduce((sum, m) => sum + m.price, 0)),
        pickupAmount: everyPlaceOffersPickup
            ? roundMoney(matches.reduce((sum, m) => sum + m.pickupPrice, 0))
            : null,
        deliveryDays: Math.max(...matches.map((m) => m.deliveryDays)),
        matches,
    };
};

export interface IChargeQuoteInput {
    lines: IPricingLine[];
    destination: IDestination;
    discountAmount: number;
    deliveryMethod: DeliveryMethod;
    /** From an applied coupon. Waives delivery, never collection. */
    couponWaivesShipping: boolean;
    /** Shop-wide rate, used only for a product with no tax rule of its own. */
    fallbackTaxPercent: number;
    /** Threshold above which delivery is free, or null when the shop has none. */
    freeShippingThreshold: number | null;
    /** The flat price of the picked `ShippingMethod`, for the no-rules fallback. */
    fallbackFlatShippingPrice: number;
}

export interface IChargeQuote {
    subtotal: number;
    taxAmount: number;
    shippingAmount: number;
    /** What delivery would cost before any waiver, for showing the shopper why it is free. */
    shippingBeforeWaiver: number;
    pickupAmount: number | null;
    deliveryDays: number | null;
    tax: ITaxQuote;
    shipping: IShippingQuote;
}

/**
 * Both charges in one call, which is what every caller actually wants.
 *
 * Free shipping — from a coupon or from the shop's order-value threshold —
 * waives *delivery* only. A shopper who chooses to collect in person is
 * choosing a different service, and its price is what that place charges for
 * it; zeroing it because delivery happened to be free would give away a
 * collection fee nobody waived.
 */
export const quoteCharges = async (input: IChargeQuoteInput): Promise<IChargeQuote> => {
    const subtotal = roundMoney(input.lines.reduce((sum, line) => sum + line.lineTotal, 0));

    const [tax, shipping] = await Promise.all([
        quoteTax(input.lines, input.discountAmount, input.fallbackTaxPercent),
        quoteShipping(input.lines, input.destination, input.fallbackFlatShippingPrice),
    ]);

    if (input.deliveryMethod === "PICKUP") {
        if (shipping.pickupAmount === null) {
            throw new AppError(
                status.BAD_REQUEST,
                "Collection in person is not available for these items",
            );
        }

        return {
            subtotal,
            taxAmount: tax.taxAmount,
            shippingAmount: shipping.pickupAmount,
            shippingBeforeWaiver: shipping.pickupAmount,
            pickupAmount: shipping.pickupAmount,
            deliveryDays: shipping.deliveryDays,
            tax,
            shipping,
        };
    }

    const meetsThreshold =
        input.freeShippingThreshold !== null && subtotal >= input.freeShippingThreshold;
    const waived = input.couponWaivesShipping || meetsThreshold;

    return {
        subtotal,
        taxAmount: tax.taxAmount,
        shippingAmount: waived ? 0 : shipping.deliveryAmount,
        shippingBeforeWaiver: shipping.deliveryAmount,
        pickupAmount: shipping.pickupAmount,
        deliveryDays: shipping.deliveryDays,
        tax,
        shipping,
    };
};
