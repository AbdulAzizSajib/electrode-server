export interface ICreateCategoryPayload {
    name: string;
    slug?: string;
    description?: string;
    image?: string;
    banner?: string;
    status?: boolean;
    parentId?: string;
    seoTitle?: string;
    seoDescription?: string;
    sortOrder?: number;
}

export interface IUpdateCategoryPayload {
    name?: string;
    slug?: string;
    description?: string;
    image?: string;
    banner?: string;
    status?: boolean;
    parentId?: string | null;
    seoTitle?: string;
    seoDescription?: string;
    sortOrder?: number;
}
