/**
 * The cost arithmetic behind `Product.purchasePrice` / `ProductVariant.purchasePrice`,
 * and the two price computations a purchase order line offers a merchant.
 *
 * Deliberately free of Prisma and of any I/O: these are the calculations
 * that can actually be wrong, and keeping them pure is what lets
 * `scripts/verify-cost-basis.ts` exercise them with plain function calls
 * instead of a database fixture per case.
 *
 * See openspec/changes/add-weighted-average-cost-basis/design.md and
 * openspec/changes/add-purchase-order-pricing/design.md Decision 4.
 */

/** Money is `Decimal(12, 2)` everywhere in this schema; every figure leaving this module matches. */
const round2 = (value: number) => Math.round(value * 100) / 100;

export interface ILandedCostLine {
    id: string;
    quantity: number;
    unitCost: number;
}

export interface ILandedCostInput {
    items: ILandedCostLine[];
    shippingCost: number;
    taxAmount: number;
}

/**
 * What each ordered unit actually cost to land, not merely what the supplier
 * invoiced for the goods.
 *
 * IAS 2 puts transport, handling and NON-RECOVERABLE duties into the cost of
 * inventory, so a purchase order's header-level `shippingCost` and `taxAmount`
 * belong in the per-unit cost rather than sitting beside it. They are spread
 * across the lines in proportion to line VALUE (`quantity × unitCost`), not
 * quantity: allocating by quantity would make a cheap bulky line and an
 * expensive small line absorb identical freight per unit, misstating both.
 *
 * Input VAT is treated as non-recoverable and therefore capitalised. That is
 * the conservative direction — capitalising a tax the merchant could have
 * reclaimed overstates cost and only makes the catalogue's margin guard
 * stricter, whereas excluding a tax they cannot reclaim understates cost and
 * reports a loss-making product as profitable. A VAT-registered merchant will
 * eventually want this behind a StoreSetting flag; see design.md Decision 3.
 *
 * Returns landed cost per UNIT, keyed by line id. Lines of zero quantity are
 * absent from the map rather than present as a division by zero — they
 * received nothing, so there is no unit to cost.
 */
export const allocateLandedUnitCosts = ({
    items,
    shippingCost,
    taxAmount,
}: ILandedCostInput): Map<string, number> => {
    const allocatable = shippingCost + taxAmount;
    const totalValue = items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);

    const landedByLine = new Map<string, number>();

    for (const item of items) {
        if (item.quantity <= 0) continue;

        const lineValue = item.quantity * item.unitCost;

        /*
         * A zero total value means every line is priced at zero (free samples,
         * or a draft nobody has costed yet). There is no value to apportion
         * against, so the allocation is skipped entirely rather than split
         * evenly — inventing a cost for goods recorded as free would be a
         * worse answer than the zero the merchant actually entered.
         */
        const share = totalValue > 0 ? (allocatable * lineValue) / totalValue : 0;

        landedByLine.set(item.id, round2((lineValue + share) / item.quantity));
    }

    return landedByLine;
};

/**
 * The moving weighted average that keeps a cost basis meaning "what the stock
 * on hand cost", rather than "what it cost the first time anyone bought it".
 *
 *     newCost = (onHandBefore × existingCost + receivedQuantity × landedUnitCost)
 *               ÷ (onHandBefore + receivedQuantity)
 *
 * `onHandBefore` MUST be read before the receipt's stock increase is applied.
 * Reading it afterwards puts the received units in the denominator but not the
 * numerator, which silently under-weights the new cost.
 *
 * Weighted average rather than FIFO because the schema holds ONE nullable
 * Decimal per item — the shape of an average, not of a cost-layer set — and
 * because IAS 2 permits only FIFO and weighted average in the first place.
 *
 * A null `existingCost` or a non-positive `onHandBefore` yields the landed cost
 * alone. An unrecorded cost is unknown, not zero; averaging it in as zero would
 * halve the basis on the first receipt of a product whose cost was never set.
 */
export const weightedAverageCost = (
    onHandBefore: number,
    existingCost: number | null,
    receivedQuantity: number,
    landedUnitCost: number,
): number => {
    if (existingCost === null || onHandBefore <= 0) {
        return round2(landedUnitCost);
    }

    const totalUnits = onHandBefore + receivedQuantity;
    if (totalUnits <= 0) {
        return round2(landedUnitCost);
    }

    return round2((onHandBefore * existingCost + receivedQuantity * landedUnitCost) / totalUnits);
};

/**
 * A selling price computed as a markup on what the line says the goods cost.
 *
 * ── Why the basis is `unitCost` and not landed cost ──────────────────────
 *
 * Landed cost is the accounting-correct basis for the COST BASIS, and
 * `allocateLandedUnitCosts` above is what computes it. It is the wrong basis
 * for this: landed cost depends on the order's header-level shipping and tax
 * apportioned across EVERY line, so it changes when an unrelated line is
 * edited. A merchant who marked up a line at 25% would find the figure no
 * longer matched the cost shown on the row, with nothing on screen to explain
 * why. `unitCost` is the number in front of them.
 *
 * ── Why zero declines rather than returning zero ─────────────────────────
 *
 * A percentage of nothing is nothing. Returning 0.00 for a line nobody has
 * costed yet would propose a free product and look like a computed answer;
 * null lets the caller say "this line needs a cost first", which is the truth.
 * A negative cost is nonsense in the same way and takes the same path.
 *
 * NOT A STORED RULE. The caller writes the returned figure into a staged price
 * and the merchant may edit it from there. Nothing re-evaluates this when the
 * line's cost later changes — see design.md Decision 4 for why storing the
 * rule instead would apply a price the line never showed.
 */
export const markupOnCost = (unitCost: number, percent: number): number | null => {
    if (unitCost <= 0) return null;

    return round2(unitCost * (1 + percent / 100));
};

/**
 * A price moved by a fixed amount: `delta` positive to increase, negative to
 * decrease. The decrease case is the same function with a negative number —
 * there is no separate subtract, because there is no separate arithmetic.
 *
 * CLAMPED AT ZERO. A decrease larger than the price would otherwise produce a
 * negative figure, and every reader of these `Decimal(12, 2)` columns assumes
 * a non-negative price. Clamping keeps the mistake visible (the merchant sees
 * 0.00 and knows the adjustment was too large) rather than storing a value
 * that would misprice a product or break a total downstream.
 *
 * Deliberately unaware of WHICH price it is adjusting: offer, regular, or a
 * figure the merchant typed. It takes a number and returns a number, so there
 * is one implementation rather than one per field.
 */
export const adjustByAmount = (price: number, delta: number): number => {
    return round2(Math.max(0, price + delta));
};
