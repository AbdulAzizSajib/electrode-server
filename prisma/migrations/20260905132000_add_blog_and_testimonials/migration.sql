-- Migration C of three. Adds the storage behind the two homepage sections a
-- merchant could not previously edit: "Our Latest Blog" and "What Our Clients
-- Say", both of which rendered from fixtures in the storefront's
-- src/data/content.ts. See
-- openspec/changes/add-currency-format-and-home-content-cms.
--
-- Purely additive: three enums and two tables. Nothing existing is altered, so
-- this is safe to deploy ahead of the admin and storefront work.
--
-- Both tables start EMPTY and that is deliberate, not a gap to backfill. The
-- storefront omits each section entirely when nothing is published
-- (`storefront-cms/blog`, `storefront-cms/testimonials`), so an unseeded shop
-- renders a shorter homepage rather than headings over empty grids. Seeding the
-- old fixtures would mean a merchant could not tell "I have not published
-- anything yet" from "someone else's demo content is on my site".
--
-- BlogPost.slug is unique but is NOT checked against Page's RESERVED_SLUGS:
-- posts live under /blogs/<slug>, a namespace of their own, whereas a Page
-- resolves at the storefront root and can collide with a real route.
--
-- The composite indexes match the only two reads either table has: published
-- posts newest first, and published testimonials in the merchant's order.

-- CreateEnum
CREATE TYPE "BlogPostStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "BlogMediaType" AS ENUM ('NONE', 'IMAGE', 'VIDEO');

-- CreateEnum
CREATE TYPE "TestimonialStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "BlogPost" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mediaType" "BlogMediaType" NOT NULL DEFAULT 'NONE',
    "imageUrl" TEXT,
    "videoUrl" TEXT,
    "videoThumbnailUrl" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metaTitle" TEXT,
    "metaDescription" TEXT,
    "status" "BlogPostStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlogPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Testimonial" (
    "id" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorRole" TEXT NOT NULL,
    "photoUrl" TEXT,
    "rating" INTEGER NOT NULL DEFAULT 5,
    "status" "TestimonialStatus" NOT NULL DEFAULT 'DRAFT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Testimonial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlogPost_slug_key" ON "BlogPost"("slug");

-- CreateIndex
CREATE INDEX "BlogPost_status_publishedAt_idx" ON "BlogPost"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "Testimonial_status_sortOrder_idx" ON "Testimonial"("status", "sortOrder");
