-- Adds Page, the merchant-authored content page behind the storefront's
-- root-level `/<slug>` route (About, Terms & Conditions, Refund Policy, FAQ).
-- See openspec/changes/add-admin-ui-cms-section.
--
-- Purely additive: one enum, one table, two indexes. Nothing existing is
-- touched, so this is safe to deploy ahead of the admin and storefront work.
--
-- NOTE: `prisma migrate dev` again generated three DROP INDEX statements here
-- for Product_name_trgm_idx, Product_sku_trgm_idx and Brand_name_trgm_idx, and
-- they have again been removed — exactly as 20260904090000_remove_shipping_methods
-- predicted. Those are pg_trgm GIN indexes created by raw SQL in
-- 20260831000000_add_product_search_indexes and not modelled in schema.prisma,
-- so Prisma reads them as drift on EVERY generated migration. Dropping them
-- would silently degrade ProductService.searchProducts to a sequential scan.
-- Expect to remove them again next time.

-- CreateEnum
CREATE TYPE "PageStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "metaTitle" TEXT,
    "metaDescription" TEXT,
    "status" "PageStatus" NOT NULL DEFAULT 'DRAFT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Page_slug_key" ON "Page"("slug");

-- CreateIndex
CREATE INDEX "Page_status_idx" ON "Page"("status");
