-- Campaign landing pages: one product, one page, one cash-on-delivery order
-- form. See openspec/changes/add-single-product-landing-page.
--
-- PURELY ADDITIVE. Two enums, one table, and four nullable-or-defaulted columns
-- on two existing tables. Nothing existing is altered or dropped, there is no
-- backfill, and every default reproduces today's behaviour exactly:
-- StoreSetting.siteMode defaults to WEBSITE, so a shop that never opens the new
-- screen keeps serving its homepage at the root and behaves as it always has.
-- Safe to deploy ahead of the admin and storefront work.
--
-- LandingPage starts EMPTY and that is deliberate. There is no such thing as a
-- default campaign — a landing page exists because a merchant is spending money
-- driving traffic to it, which is not a state this migration can invent.
--
-- Three foreign keys, three different delete rules, each chosen rather than
-- defaulted:
--   Product      -> RESTRICT. A landing page with no product cannot price,
--                   cannot quote and cannot order, so a product a campaign is
--                   still selling must have that campaign dealt with first.
--   StoreSetting -> SET NULL. Deleting the selected page while the shop is in
--                   WEBSITE mode is allowed and simply empties the pointer,
--                   which then blocks the next attempt to switch the mode on.
--                   The shop is never left serving a page that is gone. (The
--                   mode-is-on case is refused in the service layer, before it
--                   ever reaches this constraint.)
--   Order        -> SET NULL. Deleting a finished campaign must never delete or
--                   orphan the orders it produced. Order.landingPageTitle is
--                   captured at placement precisely so those orders stay
--                   readable once the id is gone.
--
-- LandingPage.slug is unique but, unlike Page.slug, is NOT checked against
-- RESERVED_SLUGS: landing pages live under /lp/<slug>, a namespace of their
-- own, whereas a Page resolves at the storefront root and can collide with a
-- real storefront route.
--
-- deliveryZones and orderForm are NOT NULL because a page cannot be rendered
-- without them — there is no sensible "no delivery zones" or "no order form"
-- state for a page whose purpose is taking orders. The remaining Json columns
-- are nullable: a section with no content is omitted from the render, which is
-- different from an empty one.

-- CreateEnum
CREATE TYPE "LandingPageStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "SiteMode" AS ENUM ('WEBSITE', 'LANDING_PAGE');

-- CreateTable
CREATE TABLE "LandingPage" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "LandingPageStatus" NOT NULL DEFAULT 'DRAFT',
    "productId" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "subheadline" TEXT,
    "badgeText" TEXT,
    "bodyHtml" TEXT NOT NULL,
    "media" JSONB,
    "highlights" JSONB,
    "faqs" JSONB,
    "quotes" JSONB,
    "trustBadges" JSONB,
    "deliveryZones" JSONB NOT NULL,
    "orderForm" JSONB NOT NULL,
    "successHeading" TEXT,
    "successMessage" TEXT,
    "metaTitle" TEXT,
    "metaDescription" TEXT,
    "ogImageUrl" TEXT,
    "facebookPixelId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LandingPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LandingPage_slug_key" ON "LandingPage"("slug");

-- CreateIndex
CREATE INDEX "LandingPage_status_idx" ON "LandingPage"("status");

-- CreateIndex
CREATE INDEX "LandingPage_productId_idx" ON "LandingPage"("productId");

-- AlterTable
ALTER TABLE "StoreSetting" ADD COLUMN     "activeLandingPageId" TEXT,
ADD COLUMN     "siteMode" "SiteMode" NOT NULL DEFAULT 'WEBSITE';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "landingPageId" TEXT,
ADD COLUMN     "landingPageTitle" TEXT;

-- CreateIndex
CREATE INDEX "Order_landingPageId_idx" ON "Order"("landingPageId");

-- AddForeignKey
ALTER TABLE "LandingPage" ADD CONSTRAINT "LandingPage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreSetting" ADD CONSTRAINT "StoreSetting_activeLandingPageId_fkey" FOREIGN KEY ("activeLandingPageId") REFERENCES "LandingPage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_landingPageId_fkey" FOREIGN KEY ("landingPageId") REFERENCES "LandingPage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
