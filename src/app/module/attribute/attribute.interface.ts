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

/**
 * One value, added to an attribute that already exists.
 *
 * Separate from `IUpdateAttributePayload` because that one carries the whole
 * `values` array and reconciles against it — anything it omits is deleted. A
 * caller that means "also sell Navy" must not have to resend Black, White and
 * Brown to say so, and must not lose them to a stale copy if someone else added
 * a colour meanwhile.
 */
export interface ICreateAttributeValuePayload {
    label: string;
    swatch?: string;
}

/** A rename, a recolour, or both. Omitted fields are left as they are. */
export interface IUpdateAttributeValuePayload {
    label?: string;
    /** `null` clears the swatch; omitted leaves it untouched. */
    swatch?: string | null;
}
