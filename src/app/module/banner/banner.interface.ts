export interface ICreateBannerPayload {
    title: string;
    subtitle?: string;
    image: string;
    mobileImage?: string;
    link?: string;
    status?: "DRAFT" | "ACTIVE" | "INACTIVE" | "SCHEDULED";
    sortOrder?: number;
    startsAt?: string;
    endsAt?: string;
}

export type IUpdateBannerPayload = Partial<ICreateBannerPayload>;
