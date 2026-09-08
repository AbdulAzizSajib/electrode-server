import { SeoContentType } from "../store-setting/store-setting.constant";

/**
 * One row of the cross-content SEO overview.
 *
 * The five models this is built from do NOT agree on names: Product and
 * Category call their columns `seoTitle`/`seoDescription`, while Page, BlogPost
 * and LandingPage call theirs `metaTitle`/`metaDescription`. Normalising here —
 * at read time, into one shape — is deliberate, and is why the change does not
 * rename five sets of columns, five validators and five admin forms to make one
 * screen tidy. See design.md Non-Goals.
 *
 * `path` is the storefront path the record is served at, built from the slug by
 * the same rules the storefront routes on. It travels with the row so the admin
 * can link straight to the live page without re-deriving five URL shapes.
 */
export interface ISeoOverviewRow {
    id: string;
    contentType: SeoContentType;
    /** The record's own display title — what the storefront falls back to. */
    title: string;
    path: string;
    /** The record's SEO override, or null when it has none. */
    metaTitle: string | null;
    metaDescription: string | null;
    /** False for drafts and archived records, which no metadata reaches. */
    isPublished: boolean;
    updatedAt: Date;
}

export interface ISeoOverviewQuery {
    contentType?: SeoContentType;
    search?: string;
    page?: number;
    limit?: number;
}

/**
 * One sitemap URL. Deliberately the three fields a sitemap needs and nothing
 * else — the alternative was reusing the paginated storefront list endpoints,
 * which would mean N round trips shipping whole product payloads to build a
 * list of URLs.
 */
export interface ISitemapEntry {
    contentType: SeoContentType;
    slug: string;
    updatedAt: Date;
}
