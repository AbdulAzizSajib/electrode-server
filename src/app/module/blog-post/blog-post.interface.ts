import { BlogMediaType, BlogPostStatus } from "../../../generated/prisma/client";

export interface ICreateBlogPostPayload {
    title: string;
    /** Omitted means "derive from the title" — see BlogPostService.createBlogPost. */
    slug?: string;
    excerpt: string;
    body: string;

    /**
     * Which media the post shows. The URL fields below are validated against
     * this in blog-post.validation.ts — IMAGE requires `imageUrl` and forbids
     * the video pair, VIDEO the reverse, NONE forbids all three. Stating the
     * type rather than inferring it from which URL is set is what makes "image
     * or video, never both" a rule the payload cannot break.
     */
    mediaType?: BlogMediaType;
    imageUrl?: string;
    videoUrl?: string;
    /** Never absent on a VIDEO post: the upload endpoint derives a frame when the merchant supplies none. */
    videoThumbnailUrl?: string;

    /** ISO date. The date on the card, and the sort key — not a publication timestamp. */
    publishedAt?: string;

    metaTitle?: string;
    metaDescription?: string;
    status?: BlogPostStatus;
}

export type IUpdateBlogPostPayload = Partial<ICreateBlogPostPayload>;

/**
 * What a listing needs: enough to render a card, without shipping every post's
 * full body in a response that renders four of them.
 */
export interface IBlogPostSummary {
    id: string;
    title: string;
    slug: string;
    excerpt: string;
    mediaType: BlogMediaType;
    imageUrl: string | null;
    videoUrl: string | null;
    videoThumbnailUrl: string | null;
    publishedAt: Date;
}
