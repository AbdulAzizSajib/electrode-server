-- Addressable storefront slot for a Campaign, so the storefront can ask which
-- campaign occupies a slot without hardcoding a campaign id.
-- See openspec/changes/add-homepage-merchandising-sections design.md Decision 4.
--
-- Additive: a new type plus a NULLABLE column, so no existing campaign is
-- enrolled into a slot and no backfill is needed.

-- CreateEnum
CREATE TYPE "CampaignPlacement" AS ENUM ('DEAL_OF_WEEK', 'FLASH_SALE');

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "placement" "CampaignPlacement";

-- CreateIndex
CREATE INDEX "Campaign_placement_idx" ON "Campaign"("placement");
