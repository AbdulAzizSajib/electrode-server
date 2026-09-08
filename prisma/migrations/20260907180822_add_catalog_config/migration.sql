-- Which optional catalog features the storefront offers:
-- { showWishlist, showCompare, showQuickView }, all booleans.
--
-- Nullable with NO backfill, deliberately. All three default to true in
-- DEFAULT_CATALOG_CONFIG, and the public read spreads the stored blob over
-- those defaults per key — so a null column, an existing row, and a fresh
-- install all report every feature as offered. This migration therefore
-- changes no store's behaviour on its own.
--
-- NOTE: the DROP INDEX statements `prisma migrate dev` generated alongside this
-- have again been removed. Those are the pg_trgm GIN indexes
-- (Product_name_trgm_idx, Product_sku_trgm_idx, Brand_name_trgm_idx) created by
-- raw SQL in 20260831000000_add_product_search_indexes and not modelled in
-- schema.prisma, which Prisma reads as drift on EVERY generated migration.
-- Dropping them would silently degrade ProductService.searchProducts to a
-- sequential scan. Expect to remove them again next time one is generated.

-- AlterTable
ALTER TABLE "StoreSetting" ADD COLUMN     "catalogConfig" JSONB;
