-- Adds the offer mechanics a campaign landing page needs to convert ad traffic:
-- a choice of packages, a deadline, a scarcity target, a phone-order number and
-- a per-page theme. See openspec/changes/add-conversion-landing-page-sections.
--
-- EVERY COLUMN IS OPTIONAL AND THERE IS NO BACKFILL, deliberately. A page that
-- sets none of them renders exactly as pages did before this migration, so
-- "not configured" and "as it always was" are the same state — which is what
-- makes this safe to deploy under live campaigns.
--
-- `stopOrdersAtDeadline` takes a DEFAULT of false rather than being nullable:
-- it is a switch, and a null switch would make every read spell `?? false`.
-- False is the pre-existing behaviour — no deadline ever closed an offer.
--
-- NOTE WHAT IS ABSENT: there is no column for how many of a scarcity run have
-- been taken. That figure is COUNTED from the page's real orders on every read.
-- A stored counter is a number someone can set, and a number that can be set
-- will eventually be set to something flattering — at which point the page is
-- lying to shoppers in a way nothing can detect. Do not add one.
--
-- `Order.landingPackage{Key,Label,Price}` are captured at placement and never
-- updated, exactly like `landingPageTitle`: editing or deleting a package must
-- not rewrite the history of orders placed under it.
--
-- NOTE — the trigram index hazard (carried forward from
-- 20260916183105_add_hot_path_indexes, which is where the full account lives):
-- `Product_name_trgm_idx`, `Product_sku_trgm_idx` and `Brand_name_trgm_idx`
-- were raw-SQL indexes Prisma read as drift and emitted DROP INDEX for in every
-- generated migration. That migration declared them in Product.prisma and
-- Brand.prisma, so generated migrations should no longer try to drop them —
-- but CHECK EVERY GENERATED MIGRATION ANYWAY. Committing those drops silently
-- degrades ProductService.searchProducts to a sequential scan, and nothing
-- fails loudly when it happens. This file contains no DROP INDEX; the generated
-- output was checked and carried none.

-- AlterTable
ALTER TABLE "LandingPage" ADD COLUMN     "offerEndsAt" TIMESTAMP(3),
ADD COLUMN     "orderPhone" TEXT,
ADD COLUMN     "packages" JSONB,
ADD COLUMN     "scarcityTarget" INTEGER,
ADD COLUMN     "stopOrdersAtDeadline" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "theme" JSONB,
ADD COLUMN     "usageIdeas" JSONB,
ADD COLUMN     "whyUs" JSONB;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "landingPackageKey" TEXT,
ADD COLUMN     "landingPackageLabel" TEXT,
ADD COLUMN     "landingPackagePrice" DECIMAL(12,2);
