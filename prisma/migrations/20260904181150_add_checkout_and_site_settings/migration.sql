-- Adds the storage behind the admin's two new UI pages: Checkout Setting and
-- Site Setting. See openspec/changes/add-checkout-and-site-settings.
--
-- Purely additive and entirely nullable. There is deliberately NO backfill:
-- DEFAULT_CHECKOUT_CONFIG and DEFAULT_THEME live in store-setting.constant.ts
-- and are merged over the stored row on read, so an existing store keeps
-- behaving and rendering identically without a single row being written. That
-- is also what makes this safe to deploy ahead of the storefront and admin
-- work — the new columns are read by nothing until those ship.
--
-- checkoutConfig and theme are JSONB gated solely by the Zod schemas in
-- store-setting.validation.ts; Postgres constrains nothing about their shape.
--
-- NOTE: `prisma migrate dev` again generated three DROP INDEX statements here
-- for Product_name_trgm_idx, Product_sku_trgm_idx and Brand_name_trgm_idx, and
-- they have again been removed — exactly as 20260904151912_add_page_model
-- predicted. Those are pg_trgm GIN indexes created by raw SQL in
-- 20260831000000_add_product_search_indexes and not modelled in schema.prisma,
-- so Prisma reads them as drift on EVERY generated migration. Dropping them
-- would silently degrade ProductService.searchProducts to a sequential scan.
-- Expect to remove them again next time.

-- AlterTable
ALTER TABLE "StoreSetting" ADD COLUMN     "checkoutConfig" JSONB,
ADD COLUMN     "footerLogoUrl" TEXT,
ADD COLUMN     "metaDescription" TEXT,
ADD COLUMN     "metaTitle" TEXT,
ADD COLUMN     "siteUrl" TEXT,
ADD COLUMN     "theme" JSONB;
