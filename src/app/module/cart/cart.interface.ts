export interface IAddCartItemPayload {
    productId: string;
    variantId?: string;
    quantity?: number;
}

export interface IUpdateCartItemPayload {
    quantity: number;
}

/* Abandoned carts — see openspec/changes/add-abandoned-carts-admin. */

export interface IAbandonedCartItem {
    productId: string;
    variantId: string | null;
    name: string;
    variantName: string | null;
    quantity: number;
    /** What the shopper would be charged now, campaign price included. */
    unitPrice: number;
    lineTotal: number;
}

export interface IAbandonedCart {
    id: string;
    /** No `guestToken` here, ever: it is the credential that opens the cart. */
    isGuest: boolean;
    customer: { name: string; phone: string | null; email: string | null } | null;
    items: IAbandonedCartItem[];
    itemCount: number;
    total: number;
    /** ISO time of the newest item add or change. */
    lastActivityAt: string;
}

export interface IAbandonedCartSummary {
    total: number;
    customer: number;
    guest: number;
    value: number;
}

export interface IPurgeCartsPayload {
    guestOlderThanDays?: 7 | 30 | 90;
    emptyCarts?: boolean;
}
