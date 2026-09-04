import { PageStatus } from "../../../generated/prisma/client";

export interface ICreatePagePayload {
    title: string;
    /** Omitted means "derive from the title" — see PageService.createPage. */
    slug?: string;
    body: string;
    metaTitle?: string;
    metaDescription?: string;
    status?: PageStatus;
    sortOrder?: number;
}

export type IUpdatePagePayload = Partial<ICreatePagePayload>;

/**
 * What the storefront's link pickers need: enough to render a menu entry and
 * build its href, without shipping every page's full body in one response.
 */
export interface IPageSummary {
    id: string;
    title: string;
    slug: string;
}
