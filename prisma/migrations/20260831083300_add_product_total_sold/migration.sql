-- Denormalized lifetime units sold, for "best selling" ordering.
-- See openspec/changes/add-homepage-merchandising-sections design.md Decision 1.
--
-- Additive: NOT NULL with a DEFAULT, so existing rows take 0 without a rewrite.
-- History is loaded separately by scripts/backfill-total-sold.mjs (Decision 6),
-- kept out of this migration so an operator can inspect and re-run it.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "totalSold" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Product_totalSold_idx" ON "Product"("totalSold");
