export interface ICreateBundleDealPayload {
    name: string;
    /** How many units the shopper must buy. At least one. */
    buyQuantity: number;
    /** How many they then get free. At least one. */
    freeQuantity: number;
}

export type IUpdateBundleDealPayload = Partial<ICreateBundleDealPayload>;
