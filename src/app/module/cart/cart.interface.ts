export interface IAddCartItemPayload {
    productId: string;
    variantId?: string;
    quantity?: number;
}

export interface IUpdateCartItemPayload {
    quantity: number;
}
