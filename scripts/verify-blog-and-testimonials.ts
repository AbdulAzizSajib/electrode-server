/**
 * Verification for the BlogPost and Testimonial modules.
 *
 * Exercises the service layer directly — the rules worth checking are the ones
 * the services and schemas own, not HTTP plumbing:
 *
 *  - a DRAFT is invisible to every public read and its slug is not disclosed;
 *  - the media invariant ("image or video, never both") survives an UPDATE, not
 *    just a create — switching type has to clear the columns the new type does
 *    not use, or the row ends up holding both;
 *  - a duplicate slug is refused by name rather than as a raw P2002;
 *  - a rating outside 1-5 is refused.
 *
 * Creates rows and deletes them again. Run with:
 *   npx tsx scripts/verify-blog-and-testimonials.ts
 */
import { prisma } from "../src/app/lib/prisma";
import { BlogPostService } from "../src/app/module/blog-post/blog-post.service";
import { TestimonialService } from "../src/app/module/testimonial/testimonial.service";
import {
    createBlogPostZodSchema,
    updateBlogPostZodSchema,
} from "../src/app/module/blog-post/blog-post.validation";
import { createTestimonialZodSchema } from "../src/app/module/testimonial/testimonial.validation";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

const BODY = "<p>A body with enough text in it to pass the blank-document check.</p>";
const created: { blog: string[]; testimonial: string[] } = { blog: [], testimonial: [] };

const main = async () => {
    // --- 1. Media invariant, at the schema ---------------------------------

    console.log("\n-- Blog media invariant --");

    const base = { title: "T", excerpt: "E", body: BODY };

    check(
        "an IMAGE post without an image is rejected",
        !createBlogPostZodSchema.safeParse({ ...base, mediaType: "IMAGE" }).success,
        "rejected",
    );

    check(
        "an IMAGE post carrying a video too is rejected",
        !createBlogPostZodSchema.safeParse({
            ...base,
            mediaType: "IMAGE",
            imageUrl: "https://cdn.test/a.jpg",
            videoUrl: "https://cdn.test/a.mp4",
        }).success,
        "rejected",
    );

    check(
        "a VIDEO post without a video is rejected",
        !createBlogPostZodSchema.safeParse({ ...base, mediaType: "VIDEO" }).success,
        "rejected",
    );

    check(
        "a NONE post carrying media is rejected",
        !createBlogPostZodSchema.safeParse({
            ...base,
            mediaType: "NONE",
            imageUrl: "https://cdn.test/a.jpg",
        }).success,
        "rejected",
    );

    check(
        "a post with no media at all is accepted",
        createBlogPostZodSchema.safeParse(base).success,
        "accepted",
    );

    check(
        "a PATCH that touches nothing media-related is accepted",
        updateBlogPostZodSchema.safeParse({ status: "PUBLISHED" }).success,
        "status-only PATCH",
    );

    check(
        "a PATCH sending a media URL without its type is rejected",
        !updateBlogPostZodSchema.safeParse({ imageUrl: "https://cdn.test/a.jpg" }).success,
        "rejected",
    );

    // --- 2. Draft invisibility and the media switch ------------------------

    console.log("\n-- Blog posts (live) --");

    const draft = await BlogPostService.createBlogPost(undefined, {
        title: "Verification draft post",
        slug: "verification-draft-post",
        excerpt: "Should never be visible publicly.",
        body: BODY,
        mediaType: "IMAGE",
        imageUrl: "https://cdn.test/draft.jpg",
    });
    created.blog.push(draft.id);

    check("a new post defaults to DRAFT", draft.status === "DRAFT", draft.status);

    check(
        "a draft is not returned by slug",
        (await BlogPostService.getPublishedBlogPostBySlug(draft.slug)) === null,
        "null, indistinguishable from a post that was never written",
    );

    check(
        "a draft is not in the recent list",
        (await BlogPostService.getRecentPublishedBlogPosts(50)).every((p) => p.id !== draft.id),
        "absent",
    );

    check(
        "a draft IS in the admin list",
        (await BlogPostService.getAdminBlogPosts({ limit: 100 } as never)).data.some(
            (p) => (p as { id: string }).id === draft.id,
        ),
        "present",
    );

    const published = await BlogPostService.updateBlogPost(undefined, draft.id, {
        status: "PUBLISHED",
    });
    check("publishing makes it visible", published.status === "PUBLISHED", "PUBLISHED");
    check(
        "a published post is returned by slug",
        (await BlogPostService.getPublishedBlogPostBySlug(draft.slug))?.id === draft.id,
        "found",
    );

    const asVideo = await BlogPostService.updateBlogPost(undefined, draft.id, {
        mediaType: "VIDEO",
        videoUrl: "https://cdn.test/clip.mp4",
        videoThumbnailUrl: "https://cdn.test/clip.jpg",
    });
    check(
        "switching image -> video CLEARS the image column",
        asVideo.mediaType === "VIDEO" && asVideo.imageUrl === null && asVideo.videoUrl !== null,
        `mediaType=${asVideo.mediaType} imageUrl=${asVideo.imageUrl} videoUrl=${asVideo.videoUrl}`,
    );

    const asNone = await BlogPostService.updateBlogPost(undefined, draft.id, {
        mediaType: "NONE",
    });
    check(
        "switching to NONE clears every media column",
        asNone.imageUrl === null && asNone.videoUrl === null && asNone.videoThumbnailUrl === null,
        "all null",
    );

    // Slug conflict, reported by name.
    let slugError = "";
    try {
        const clash = await BlogPostService.createBlogPost(undefined, {
            title: "Another post",
            slug: "verification-draft-post",
            excerpt: "Clashing slug.",
            body: BODY,
        });
        created.blog.push(clash.id);
    } catch (err) {
        slugError = err instanceof Error ? err.message : String(err);
    }
    check(
        "a duplicate slug is refused, naming the conflicting post",
        slugError.includes("Verification draft post"),
        slugError || "NO ERROR RAISED",
    );

    // Slug derivation from the title.
    const derived = await BlogPostService.createBlogPost(undefined, {
        title: "Hello There World!",
        excerpt: "Slug derived from the title.",
        body: BODY,
    });
    created.blog.push(derived.id);
    check("a slug is derived from the title", derived.slug === "hello-there-world", derived.slug);

    // --- 3. Testimonials ---------------------------------------------------

    console.log("\n-- Testimonials --");

    for (const bad of [0, 6, 4.5]) {
        check(
            `a rating of ${bad} is rejected`,
            !createTestimonialZodSchema.safeParse({
                quote: "q",
                authorName: "n",
                authorRole: "r",
                rating: bad,
            }).success,
            "rejected",
        );
    }

    const t = await TestimonialService.createTestimonial(undefined, {
        quote: "Verification testimonial.",
        authorName: "Test Person",
        authorRole: "Verified Buyer",
        rating: 4,
    });
    created.testimonial.push(t.id);

    check("a new testimonial defaults to DRAFT", t.status === "DRAFT", t.status);
    check("the stored rating is the one given", t.rating === 4, String(t.rating));
    check(
        "a draft testimonial is not public",
        (await TestimonialService.getPublishedTestimonials()).every((x) => x.id !== t.id),
        "absent",
    );

    await TestimonialService.updateTestimonial(undefined, t.id, { status: "PUBLISHED" });
    check(
        "a published testimonial is public",
        (await TestimonialService.getPublishedTestimonials()).some((x) => x.id === t.id),
        "present",
    );

    const noPhoto = await TestimonialService.createTestimonial(undefined, {
        quote: "No photo on this one.",
        authorName: "Anon Person",
        authorRole: "Customer",
    });
    created.testimonial.push(noPhoto.id);
    check(
        "a testimonial without a photo is accepted",
        noPhoto.photoUrl === null,
        "photoUrl is null, the storefront renders initials",
    );

    // --- 4. Empty-state guarantee -----------------------------------------

    console.log("\n-- Empty state --");

    // Clean up first, so the counts below describe a shop with nothing published.
    await prisma.blogPost.deleteMany({ where: { id: { in: created.blog } } });
    await prisma.testimonial.deleteMany({ where: { id: { in: created.testimonial } } });
    created.blog = [];
    created.testimonial = [];

    const [posts, testimonials] = await Promise.all([
        BlogPostService.getRecentPublishedBlogPosts(4),
        TestimonialService.getPublishedTestimonials(4),
    ]);

    check(
        "with nothing published the blog read is empty, not an error",
        Array.isArray(posts) && posts.length === 0,
        `${posts.length} posts — the storefront omits the section entirely`,
    );
    check(
        "with nothing published the testimonial read is empty, not an error",
        Array.isArray(testimonials) && testimonials.length === 0,
        `${testimonials.length} testimonials — the storefront omits the section entirely`,
    );

    console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}\n`);
};

main()
    .catch((err) => {
        console.error(err);
        failures += 1;
    })
    .finally(async () => {
        // Belt and braces: nothing this script created survives it, even on a
        // mid-run throw.
        if (created.blog.length) {
            await prisma.blogPost.deleteMany({ where: { id: { in: created.blog } } });
        }
        if (created.testimonial.length) {
            await prisma.testimonial.deleteMany({ where: { id: { in: created.testimonial } } });
        }
        await prisma.$disconnect();
        process.exit(failures === 0 ? 0 : 1);
    });
