export interface IAttributeValueInput {
    /** Present on update to target an existing value; omitted to create a new one. */
    id?: string;
    label: string;
    /** CSS colour, used only when the owning attribute renders as SWATCH. */
    swatch?: string;
}

export interface ICreateAttributePayload {
    name: string;
    presentation?: "SWATCH" | "LABEL";
    /**
     * In the order a shopper should see them. Position is taken from array
     * order rather than sent explicitly, so two values cannot claim the same
     * position — and S -> M -> XL is not derivable from the labels.
     */
    values: IAttributeValueInput[];
}

export type IUpdateAttributePayload = Partial<ICreateAttributePayload>;
