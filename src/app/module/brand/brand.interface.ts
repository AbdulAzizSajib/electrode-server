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

export interface IBulkCreateBrandsPayload {
    names: string[];
}

export interface IBulkCreateBrandsResult {
    created: Array<{ id: string; name: string; slug: string }>;
    skipped: Array<{ name: string; reason: string }>;
}
