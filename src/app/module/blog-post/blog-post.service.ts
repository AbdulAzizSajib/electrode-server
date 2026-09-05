import status from "http-status";
import { AuditAction, BlogPostStatus, Prisma } from "../../../generated/prisma/client";
import AppError from "../../errorHelpers/AppError";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { revalidateStorefront } from "../../utils/revalidateStorefront";
import { AuditLogService } from "../audit-log/audit-log.service";
import { BLOG_POSTS_TAG, slugifyTitle } from "./blog-post.constant";
import {
    IBlogPostSummary,
    ICreateBlogPostPayload,
    IUpdateBlogPostPayload,
} from "./blog-post.interface";

/**
 * What a listing selects. Deliberately excludes `body`: the homepage section
 * renders four cards, and shipping four rich-text documents to draw four
 * excerpts is the difference between a small response and a large one.
 */
const SUMMARY_SELECT = {
    id: true,
    title: true,
    slug: true,
    excerpt: true,
    mediaType: true,
    imageUrl: true,
    videoUrl: true,
    videoThumbnailUrl: true,
    publishedAt: true,
} satisfies Prisma.BlogPostSelect;

/**
 * Resolves the slug a write should store.
 *
 * An explicit slug wins. Otherwise it is derived from the title, and the
 * derived value is re-checked for emptiness — the Zod schema only validates a
 * slug the client actually sent, so a title of "!!!" would otherwise produce an
 * empty slug and a post at `/blogs/`.
 */
const resolveSlug = (explicit: string | undefined, title: string | undefined): string => {
    if (explicit) return explicit;

    const derived = slugifyTitle(title ?? "");

    if (!derived) {
        throw new AppError(
            status.BAD_REQUEST,
            "Could not derive a slug from this title — enter one manually",
        );
    }

    return derived;
};

/**
 * Checked before the write rather than relying on Prisma's unique constraint,
 * so the merchant gets the conflicting post's title instead of a raw P2002.
 * `excludeId` lets an update keep its own slug.
 */
const assertSlugAvailable = async (slug: string, excludeId?: string) => {
    const clash = await prisma.blogPost.findUnique({
        where: { slug },
        select: { id: true, title: true },
    });

    if (clash && clash.id !== excludeId) {
        throw new AppError(
            status.CONFLICT,
            `The slug "${slug}" is already used by the post "${clash.title}"`,
        );
    }
};

const getBlogPostOrThrow = async (id: string) => {
    const post = await prisma.blogPost.findUnique({ where: { id } });

    if (!post) {
        throw new AppError(status.NOT_FOUND, "Blog post not found");
    }

    return post;
};

/**
 * Turns the payload's ISO date into a Date, leaving it absent when the client
 * did not send one so the column default applies on create and the stored value
 * survives on update.
 */
const withParsedDate = <T extends { publishedAt?: string }>(payload: T) => {
    const { publishedAt, ...rest } = payload;
    return {
        ...rest,
        ...(publishedAt !== undefined ? { publishedAt: new Date(publishedAt) } : {}),
    };
};

const createBlogPost = async (userId: string | undefined, payload: ICreateBlogPostPayload) => {
    const slug = resolveSlug(payload.slug, payload.title);

    await assertSlugAvailable(slug);

    const post = await prisma.blogPost.create({
        data: { ...withParsedDate(payload), slug },
    });

    await AuditLogService.record(userId, AuditAction.CREATE, "BlogPost", post.id, {
        newData: post,
    });

    revalidateStorefront(BLOG_POSTS_TAG);

    return post;
};

const updateBlogPost = async (
    userId: string | undefined,
    id: string,
    payload: IUpdateBlogPostPayload,
) => {
    const existing = await getBlogPostOrThrow(id);

    // Only re-resolve when the client actually touched the slug. A PATCH that
    // just flips `status` must not silently re-derive the slug from the title
    // and move a live post's URL out from under its inbound links.
    const slug = payload.slug !== undefined ? resolveSlug(payload.slug, existing.title) : undefined;

    if (slug && slug !== existing.slug) {
        await assertSlugAvailable(slug, id);
    }

    /*
     * When the media type changes, the columns the new type does not use are
     * explicitly nulled. Without this, switching an image post to a video would
     * leave `imageUrl` populated — a row carrying both, which is exactly what
     * the validation refuses to accept from a client and so must not be
     * reachable through an update either.
     */
    const clearedMedia =
        payload.mediaType === undefined
            ? {}
            : {
                  imageUrl: payload.mediaType === "IMAGE" ? (payload.imageUrl ?? null) : null,
                  videoUrl: payload.mediaType === "VIDEO" ? (payload.videoUrl ?? null) : null,
                  videoThumbnailUrl:
                      payload.mediaType === "VIDEO" ? (payload.videoThumbnailUrl ?? null) : null,
              };

    const post = await prisma.blogPost.update({
        where: { id },
        data: {
            ...withParsedDate(payload),
            ...(slug ? { slug } : {}),
            ...clearedMedia,
        },
    });

    await AuditLogService.record(userId, AuditAction.UPDATE, "BlogPost", id, {
        oldData: existing,
        newData: post,
    });

    revalidateStorefront(BLOG_POSTS_TAG);

    return post;
};

const deleteBlogPost = async (userId: string | undefined, id: string) => {
    const existing = await getBlogPostOrThrow(id);

    const post = await prisma.blogPost.delete({ where: { id } });

    await AuditLogService.record(userId, AuditAction.DELETE, "BlogPost", id, {
        oldData: existing,
    });

    revalidateStorefront(BLOG_POSTS_TAG);

    return post;
};

/** Admin: any status, searchable, paginated. */
const getAdminBlogPosts = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.blogPost, queryParams, {
        searchableFields: ["title", "slug", "excerpt"],
        filterableFields: ["status", "mediaType"],
    });

    return queryBuilder.search().filter().sort().paginate().execute();
};

/**
 * Public: PUBLISHED only, newest first, paginated.
 *
 * Paginated by the same QueryBuilder the admin list uses so the storefront's
 * index and the admin's list agree about what page 2 is. `status` is forced
 * rather than filtered from the query string — a public caller must not be able
 * to ask for drafts.
 */
const getPublishedBlogPosts = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder<IBlogPostSummary, Prisma.BlogPostWhereInput>(
        prisma.blogPost,
        // Newest first unless the caller asks otherwise. QueryBuilder.sort()
        // falls back to `createdAt`, which for a blog is the wrong axis: a post
        // written last week and dated last year belongs where its date puts it.
        { ...queryParams, sortBy: queryParams.sortBy || "publishedAt" },
        { searchableFields: ["title", "excerpt"] },
    );

    return queryBuilder
        // Forced, not read from the query string — a public caller must not be
        // able to ask for drafts by passing `?status=DRAFT`. `filter()` is
        // deliberately not called here for the same reason.
        .where({ status: BlogPostStatus.PUBLISHED })
        .select(SUMMARY_SELECT)
        .search()
        .sort()
        .paginate()
        .execute();
};

/**
 * Public: the most recent published posts, for the homepage section.
 *
 * A dedicated read rather than the paginated one with `limit`, because the
 * homepage asks a fixed question with a fixed answer and should not carry
 * pagination metadata it ignores.
 */
const getRecentPublishedBlogPosts = async (take: number): Promise<IBlogPostSummary[]> => {
    return prisma.blogPost.findMany({
        where: { status: BlogPostStatus.PUBLISHED },
        select: SUMMARY_SELECT,
        orderBy: { publishedAt: "desc" },
        take,
    });
};

/**
 * Public: PUBLISHED only. A DRAFT and a non-existent slug both resolve to null,
 * so the response never lets a visitor tell an unpublished post from one that
 * was never written.
 */
const getPublishedBlogPostBySlug = async (slug: string) => {
    return prisma.blogPost.findFirst({
        where: { slug, status: BlogPostStatus.PUBLISHED },
    });
};

export const BlogPostService = {
    createBlogPost,
    updateBlogPost,
    deleteBlogPost,
    getAdminBlogPosts,
    getBlogPostOrThrow,
    getPublishedBlogPosts,
    getRecentPublishedBlogPosts,
    getPublishedBlogPostBySlug,
};
