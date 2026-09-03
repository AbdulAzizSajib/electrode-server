export interface ICreateTaxRulePayload {
    name: string;
    type?: "FLAT" | "PERCENT";
    /** A percentage when `type` is PERCENT, an amount when FLAT. */
    value: number;
}

export type IUpdateTaxRulePayload = Partial<ICreateTaxRulePayload>;
