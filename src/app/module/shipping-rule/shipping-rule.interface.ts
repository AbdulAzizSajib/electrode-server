export interface IShippingPlaceInput {
    /** Present on update to target an existing place; omitted to create a new one. */
    id?: string;
    /** What the shopper sees at checkout. Falls back to a delivery-time label when blank. */
    name?: string;
    /** ISO country code, or omitted for every country. */
    country?: string;
    /** Region within `country`, or omitted for every region in it. */
    state?: string;
    price: number;
    deliveryDays?: number;
    offersPickup?: boolean;
    pickupPrice?: number;
}

export interface ICreateShippingRulePayload {
    name: string;
    /** A rule must always keep at least one place — one matching nowhere can charge nothing. */
    places: IShippingPlaceInput[];
}

export type IUpdateShippingRulePayload = Partial<ICreateShippingRulePayload>;
