-- Header/footer brand display: whether each of the storefront's two brand slots
-- shows the text wordmark or its logo image, and how tall that logo renders.
--
-- Purely additive. Four columns on the singleton settings row plus one enum, no
-- backfill, nothing dropped or altered.
--
-- BOTH MODES DEFAULT TO 'TEXT', and that is the entire backwards-compatibility
-- story. Before this migration the storefront rendered the wordmark
-- unconditionally in both slots — Header.tsx and Footer.tsx never read
-- `logoUrl` or `footerLogoUrl` at all, so the two logo columns were stored and
-- served but never displayed. TEXT therefore reproduces existing rendering
-- exactly, including for a store that had already uploaded artwork: that
-- artwork simply becomes available rather than suddenly going live. No
-- storefront's appearance changes when this is applied.
--
-- The heights are bounded 24-96 in store-setting.validation.ts, NOT here.
-- Postgres could express it as a CHECK, but the repo's convention is that Zod
-- is the single gate for values whose range the schema cannot state (see
-- `currencyDecimals`), and two gates that can disagree is worse than one. The
-- defaults below are the values the storefront renders at when unset.
--
-- Width is deliberately not stored. The storefront reserves the configured
-- height and lets width follow the image's own proportions, which is what keeps
-- a late-arriving logo from shifting the page — without probing the dimensions
-- of every upload. See openspec/changes/add-header-footer-brand-display,
-- design.md Decisions 1, 2 and 3.
--
-- NOTE: the DROP INDEX statements `prisma migrate diff` generated alongside this
-- have again been removed — the pg_trgm GIN indexes from
-- 20260831000000_add_product_search_indexes, which Prisma reads as drift on
-- every generated migration because they cannot be expressed in schema.prisma.
-- Dropping them would silently degrade ProductService.searchProducts to a
-- sequential scan. This migration keeps no DROP INDEX of its own.

-- CreateEnum
CREATE TYPE "BrandDisplayMode" AS ENUM ('TEXT', 'LOGO');

-- AlterTable
ALTER TABLE "StoreSetting" ADD COLUMN     "headerBrandMode" "BrandDisplayMode" NOT NULL DEFAULT 'TEXT',
ADD COLUMN     "footerBrandMode" "BrandDisplayMode" NOT NULL DEFAULT 'TEXT',
ADD COLUMN     "headerLogoHeight" INTEGER NOT NULL DEFAULT 40,
ADD COLUMN     "footerLogoHeight" INTEGER NOT NULL DEFAULT 36;
