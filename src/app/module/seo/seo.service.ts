import {
    BlogPostStatus,
    LandingPageStatus,
    PageStatus,
    ProductStatus,
} from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { SEO_CONTENT_TYPES, SeoContentType } from "../store-setting/store-setting.constant";
import { StoreSettingService } from "../store-setting/store-setting.service";
import { ISeoOverviewQuery, ISeoOverviewRow, ISitemapEntry } from "./seo.interface";

/**
 * Where each content type is served on the storefront. One place, so the admin's
 * "view live page" link and the sitemap cannot disagree about a URL.
 *
 * Category has no dedicated route today — the storefront filters the product
 * list instead — so it is a query string rather than a path segment. That is the
 * real URL, and writing it here keeps the sitemap honest rather than advertising
 * a `/category/<slug>` route that would 404.
 */
const pathForSlug = (contentType: SeoContentType, slug: string): string => {
    switch (contentType) {
        case "product":
            return `/products/${slug}`;
        case "category":
            return `/products?category=${encodeURIComponent(slug)}`;
        case "page":
            return `/${slug}`;
        case "blogPost":
            return `/blogs/${slug}`;
        case "landingPage":
            return `/lp/${slug}`;
    }
};

/**
 * "Published" means a different column on every one of the five models —
 * ProductStatus.ACTIVE, a Category boolean, and PUBLISHED on the three content
 * types. Gathered here so the overview and the sitemap apply the same rule.
 */
const PUBLISHED_WHERE = {
    product: { status: ProductStatus.ACTIVE },
    category: { status: true },
    page: { status: PageStatus.PUBLISHED },
    blogPost: { status: BlogPostStatus.PUBLISHED },
    landingPage: { status: LandingPageStatus.PUBLISHED },
} as const;

/**
 * Every SEO-bearing record across the five content types, as one list.
 *
 * Five queries and pagination in application code, deliberately: the rows come
 * from five tables with no shared parent, so there is nothing to paginate in SQL
 * without a view. Bounded in practice by the content-type filter and search,
 * which is how the screen is actually used. If it ever becomes slow the fix is a
 * materialised view, not a schema change — see design.md Decision 3.
 *
 * READ-ONLY. Edits from this screen go to each resource's own PATCH endpoint, so
 * there is exactly one writer per field and the two entry points cannot drift.
 */
const getSeoOverview = async (query: ISeoOverviewQuery) => {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.max(1, Math.min(100, query.limit ?? 20));
    const search = query.search?.trim();

    // `mode: "insensitive"` rather than the pg_trgm indexes product search uses:
    // this searches five tables on two columns each, and the admin types a few
    // characters into a screen that is not a hot path.
    const contains = search ? { contains: search, mode: "insensitive" as const } : undefined;
    const wanted = query.contentType ? [query.contentType] : [...SEO_CONTENT_TYPES];
    const wants = (type: SeoContentType) => wanted.includes(type);

    const [products, categories, pages, blogPosts, landingPages] = await Promise.all([
        wants("product")
            ? prisma.product.findMany({
                  where: contains
                      ? { OR: [{ name: contains }, { seoTitle: contains }, { slug: contains }] }
                      : {},
                  select: {
                      id: true,
                      name: true,
                      slug: true,
                      status: true,
                      seoTitle: true,
                      seoDescription: true,
                      updatedAt: true,
                  },
              })
            : [],
        wants("category")
            ? prisma.category.findMany({
                  where: contains
                      ? { OR: [{ name: contains }, { seoTitle: contains }, { slug: contains }] }
                      : {},
                  select: {
                      id: true,
                      name: true,
                      slug: true,
                      status: true,
                      seoTitle: true,
                      seoDescription: true,
                      updatedAt: true,
                  },
              })
            : [],
        wants("page")
            ? prisma.page.findMany({
                  where: contains
                      ? { OR: [{ title: contains }, { metaTitle: contains }, { slug: contains }] }
                      : {},
                  select: {
                      id: true,
                      title: true,
                      slug: true,
                      status: true,
                      metaTitle: true,
                      metaDescription: true,
                      updatedAt: true,
                  },
              })
            : [],
        wants("blogPost")
            ? prisma.blogPost.findMany({
                  where: contains
                      ? { OR: [{ title: contains }, { metaTitle: contains }, { slug: contains }] }
                      : {},
                  select: {
                      id: true,
                      title: true,
                      slug: true,
                      status: true,
                      metaTitle: true,
                      metaDescription: true,
                      updatedAt: true,
                  },
              })
            : [],
        wants("landingPage")
            ? prisma.landingPage.findMany({
                  where: contains
                      ? { OR: [{ title: contains }, { metaTitle: contains }, { slug: contains }] }
                      : {},
                  select: {
                      id: true,
                      title: true,
                      slug: true,
                      status: true,
                      metaTitle: true,
                      metaDescription: true,
                      updatedAt: true,
                  },
              })
            : [],
    ]);

    const rows: ISeoOverviewRow[] = [
        ...products.map((r) => ({
            id: r.id,
            contentType: "product" as const,
            title: r.name,
            path: pathForSlug("product", r.slug),
            metaTitle: r.seoTitle,
            metaDescription: r.seoDescription,
            isPublished: r.status === ProductStatus.ACTIVE,
            updatedAt: r.updatedAt,
        })),
        ...categories.map((r) => ({
            id: r.id,
            contentType: "category" as const,
            title: r.name,
            path: pathForSlug("category", r.slug),
            metaTitle: r.seoTitle,
            metaDescription: r.seoDescription,
            isPublished: r.status,
            updatedAt: r.updatedAt,
        })),
        ...pages.map((r) => ({
            id: r.id,
            contentType: "page" as const,
            title: r.title,
            path: pathForSlug("page", r.slug),
            metaTitle: r.metaTitle,
            metaDescription: r.metaDescription,
            isPublished: r.status === PageStatus.PUBLISHED,
            updatedAt: r.updatedAt,
        })),
        ...blogPosts.map((r) => ({
            id: r.id,
            contentType: "blogPost" as const,
            title: r.title,
            path: pathForSlug("blogPost", r.slug),
            metaTitle: r.metaTitle,
            metaDescription: r.metaDescription,
            isPublished: r.status === BlogPostStatus.PUBLISHED,
            updatedAt: r.updatedAt,
        })),
        ...landingPages.map((r) => ({
            id: r.id,
            contentType: "landingPage" as const,
            title: r.title,
            path: pathForSlug("landingPage", r.slug),
            metaTitle: r.metaTitle,
            metaDescription: r.metaDescription,
            isPublished: r.status === LandingPageStatus.PUBLISHED,
            updatedAt: r.updatedAt,
        })),
    ];

    // Most recently edited first: the row a merchant wants is almost always the
    // one they just touched, and the five sources arrive grouped by type.
    rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    const total = rows.length;
    const start = (page - 1) * limit;

    return {
        data: rows.slice(start, start + limit),
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
};

/**
 * Published, indexable URLs for the storefront's sitemap.
 *
 * Both filters are applied HERE rather than on the storefront: the per-type
 * toggles and the global noindex switch are settings the server owns, and a
 * sitemap is exactly the surface where "the client forgot to check" means
 * publishing URLs a merchant asked to keep out of search.
 */
const getSitemapEntries = async (): Promise<ISitemapEntry[]> => {
    const settings = await StoreSettingService.getPublicStoreSetting();
    const { seoConfig } = settings;

    // The staging kill switch. An empty sitemap, not a 404 — a sitemap that
    // exists and lists nothing is an unambiguous "index none of this".
    if (seoConfig.robots.globalNoindex) return [];

    const enabled = (type: SeoContentType) => seoConfig.sitemap[type];

    const [products, categories, pages, blogPosts, landingPages] = await Promise.all([
        enabled("product")
            ? prisma.product.findMany({
                  where: PUBLISHED_WHERE.product,
                  select: { slug: true, updatedAt: true },
              })
            : [],
        enabled("category")
            ? prisma.category.findMany({
                  where: PUBLISHED_WHERE.category,
                  select: { slug: true, updatedAt: true },
              })
            : [],
        enabled("page")
            ? prisma.page.findMany({
                  where: PUBLISHED_WHERE.page,
                  select: { slug: true, updatedAt: true },
              })
            : [],
        enabled("blogPost")
            ? prisma.blogPost.findMany({
                  where: PUBLISHED_WHERE.blogPost,
                  select: { slug: true, updatedAt: true },
              })
            : [],
        enabled("landingPage")
            ? prisma.landingPage.findMany({
                  where: PUBLISHED_WHERE.landingPage,
                  select: { slug: true, updatedAt: true },
              })
            : [],
    ]);

    const withType = (
        rows: { slug: string; updatedAt: Date }[],
        contentType: SeoContentType,
    ): ISitemapEntry[] => rows.map((r) => ({ contentType, slug: r.slug, updatedAt: r.updatedAt }));

    return [
        ...withType(products, "product"),
        ...withType(categories, "category"),
        ...withType(pages, "page"),
        ...withType(blogPosts, "blogPost"),
        ...withType(landingPages, "landingPage"),
    ];
};

export const SeoService = {
    getSeoOverview,
    getSitemapEntries,
};
