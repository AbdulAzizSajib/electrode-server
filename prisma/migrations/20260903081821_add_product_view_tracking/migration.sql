-- Counts product-page views for real, replacing a number the storefront
-- fabricated client-side on every mount. Gives a merchant the one signal they
-- could not get: which products people find and do not buy, as distinct from
-- products nobody finds at all.
-- See openspec/changes/add-product-view-tracking design.md.
--
-- Product.viewCount is a LIFETIME TOTAL and says nothing about the present
-- moment. ProductView is its dedup ledger — one row per (viewer, product,
-- window) — and is never read to answer "how many viewers now"; rows are safe
-- to prune on any schedule without affecting the counter.
--
-- The unique constraint is the mechanism, not a nicety: it makes a duplicate
-- insert fail, so only a genuinely new row increments the counter and two
-- instances racing on the same viewer cannot both count. viewerKey is a keyed
-- hash of IP + user-agent (or the customer id when signed in) — never a raw
-- address, which beside a browsing history would be personal data.
--
-- Additive: a defaulted column and a new table. Existing products start at 0,
-- which is accurate — no views were ever recorded.

-- NOTE: `prisma migrate dev` again generated three DROP INDEX statements here
-- for Product_name_trgm_idx, Product_sku_trgm_idx and Brand_name_trgm_idx, and
-- they have again been removed. Those are pg_trgm GIN indexes created by raw
-- SQL in 20260831000000_add_product_search_indexes and not modelled in
-- schema.prisma, so Prisma reads them as drift on EVERY generated migration.
-- Dropping them would silently degrade ProductService.searchProducts to a
-- sequential scan. Expect to remove them again next time.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "viewCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ProductView" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "viewerKey" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductView_productId_idx" ON "ProductView"("productId");

-- CreateIndex
CREATE INDEX "ProductView_windowStart_idx" ON "ProductView"("windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "ProductView_productId_viewerKey_windowStart_key" ON "ProductView"("productId", "viewerKey", "windowStart");

-- CreateIndex
CREATE INDEX "Product_viewCount_idx" ON "Product"("viewCount");

-- AddForeignKey
ALTER TABLE "ProductView" ADD CONSTRAINT "ProductView_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
