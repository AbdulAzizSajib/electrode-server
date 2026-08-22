export interface IUpdateStoreSettingPayload {
    storeName?: string;
    currency?: string;
    currencySymbol?: string;
    defaultTaxRatePercent?: number;
    freeShippingThreshold?: number;
    contactEmail?: string;
    contactPhone?: string;
    address?: string;
}
