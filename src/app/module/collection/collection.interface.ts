export interface ICreateCollectionPayload {
    name: string;
    /** Derived from `name` when omitted. */
    slug?: string;
    /** Hidden collections keep their products and are simply not presented. */
    isVisible?: boolean;
}

export type IUpdateCollectionPayload = Partial<ICreateCollectionPayload>;
