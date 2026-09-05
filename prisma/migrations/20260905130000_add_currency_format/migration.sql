-- Migration A of three. Adds how a monetary amount is written: which side the
-- currency symbol sits on, and how many decimal places show.
-- See openspec/changes/add-currency-format-and-home-content-cms.
--
-- Purely additive, and the defaults reproduce the storefront's current
-- rendering exactly (`৳` before the amount, two decimals). Deploying this
-- migration on its own therefore changes nothing anywhere — the columns are
-- read by no code until the formatting work ships. That is deliberate: it is
-- the safe half of this change and can go ahead of the destructive half.
--
-- Kept SEPARATE from Migration B, which drops defaultTaxRatePercent. Rolling
-- back the destructive step must not take these columns with it.
--
-- currencyDecimals is bounded 0-4 in store-setting.validation.ts rather than by
-- a CHECK constraint, matching how every other bounded number on this table is
-- handled (maxPendingCodOrdersPerPhone, the theme's maxWidth). It is a
-- PRESENTATION setting only: money stays DECIMAL(12,2) and is computed in
-- cents, so a store set to 0 decimals still charges 1200.50 while displaying
-- 1,201.
--
-- NOTE: written by hand rather than by `prisma migrate dev`, which would again
-- have generated three DROP INDEX statements for Product_name_trgm_idx,
-- Product_sku_trgm_idx and Brand_name_trgm_idx — the pg_trgm GIN indexes
-- created by raw SQL in 20260831000000_add_product_search_indexes and not
-- modelled in schema.prisma, which Prisma reads as drift on EVERY generated
-- migration. Dropping them would silently degrade
-- ProductService.searchProducts to a sequential scan. Expect to remove them
-- again next time one is generated.

-- CreateEnum
CREATE TYPE "CurrencyPosition" AS ENUM ('BEFORE', 'AFTER');

-- AlterTable
ALTER TABLE "StoreSetting" ADD COLUMN     "currencyDecimals" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "currencyPosition" "CurrencyPosition" NOT NULL DEFAULT 'BEFORE';
