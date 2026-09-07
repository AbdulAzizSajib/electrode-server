/**
 * The cost arithmetic behind `Product.purchasePrice` / `ProductVariant.purchasePrice`.
 *
 * Deliberately free of Prisma and of any I/O: these are the two calculations
 * that can actually be wrong, and keeping them pure is what lets
 * `scripts/verify-cost-basis.ts` exercise them with plain function calls
 * instead of a database fixture per case.
 *
 * See openspec/changes/add-weighted-average-cost-basis/design.md.
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
