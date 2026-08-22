export interface ICreateBrandPayload {
    name: string;
    slug?: string;
    description?: string;
    logo?: string;
    status?: boolean;
}

export interface IUpdateBrandPayload {
    name?: string;
    slug?: string;
    description?: string;
    logo?: string;
    status?: boolean;
}
