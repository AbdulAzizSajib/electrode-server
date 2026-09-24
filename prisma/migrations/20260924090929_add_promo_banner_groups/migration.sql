-- Adds `PromoBannerGroup` and `Banner.promoBannerGroupId`: the homepage's promo
-- strip becomes a merchant-created, repeatable thing with its own tile count,
-- instead of the single hardcoded three-across band the storefront rendered.
--
-- THE BACKFILL AT THE BOTTOM IS WHAT MAKES THIS UPGRADE INVISIBLE. Adding the
-- table and the column alone would leave every existing store's promo banners
-- belonging to no group — and since `reconcileHomeConfig` drops a MID_BANNERS
-- entry whose group is missing and then splices a fresh enabled one, the result
-- would be: the merchant's deliberate "promo section off" silently switched on,
-- and the strip moved to the registry's default position. So the group is
-- created, the banners are adopted, and the STORED homeConfig entry is rewritten
-- in place, keeping its position and its enabled flag.
--
-- Done here in SQL rather than lazily on read, because a read-time repair would
-- have to run on every settings read forever AND would have no way to tell a
-- legacy entry (adopt it) from an entry whose group was deleted (drop it) —
-- the two cases need opposite treatment and look identical after the fact.
--
-- See openspec/changes/add-promo-banner-groups, design.md Decision 7.
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

-- CreateEnum
CREATE TYPE "PromoBannerLayout" AS ENUM ('ONE', 'TWO', 'THREE');

-- AlterTable
ALTER TABLE "Banner" ADD COLUMN     "promoBannerGroupId" TEXT;

-- CreateTable
CREATE TABLE "PromoBannerGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "layout" "PromoBannerLayout" NOT NULL DEFAULT 'THREE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoBannerGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromoBannerGroup_sortOrder_idx" ON "PromoBannerGroup"("sortOrder");

-- CreateIndex
CREATE INDEX "Banner_promoBannerGroupId_sortOrder_idx" ON "Banner"("promoBannerGroupId", "sortOrder");

-- AddForeignKey
ALTER TABLE "Banner" ADD CONSTRAINT "Banner_promoBannerGroupId_fkey" FOREIGN KEY ("promoBannerGroupId") REFERENCES "PromoBannerGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Backfill: adopt the existing promo strip
-- ---------------------------------------------------------------------------
--
-- Wrapped in a DO block for one reason: the group's id has to be generated once
-- and then used by two later statements, and plain migration SQL has no way to
-- carry a value between statements. Prisma already runs the whole migration in
-- a transaction, so this adds no atomicity that was not already there.
--
-- `gen_random_uuid()` rather than a uuid7 — the application generates uuid7 for
-- new rows, but this is one row created once and never sorted by its id, so
-- pulling in a uuid7 implementation for it would be cost with no reader.
DO $$
DECLARE
    group_id TEXT;
BEGIN
    -- ONLY IF THE STORE ACTUALLY HAS PROMO ARTWORK. A store with no MID banners
    -- had no promo strip to preserve, and creating an empty group for it would
    -- put an empty section on a homepage that never had one — reconciliation
    -- splices an enabled entry for every group that exists.
    IF NOT EXISTS (SELECT 1 FROM "Banner" WHERE "placement" = 'MID') THEN
        RETURN;
    END IF;

    group_id := gen_random_uuid()::TEXT;

    -- THREE, matching what the storefront rendered before this change. The
    -- column's own default says the same thing; it is stated explicitly here
    -- because this row is the one case where "what it used to look like" is the
    -- requirement rather than a default worth inheriting.
    INSERT INTO "PromoBannerGroup" ("id", "name", "layout", "sortOrder", "createdAt", "updatedAt")
    VALUES (group_id, 'Promo banners', 'THREE', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

    -- Every MID banner, regardless of status. An INACTIVE or SCHEDULED banner
    -- is still this strip's artwork; leaving it ungrouped would quietly detach
    -- it, so that activating it later would put it nowhere.
    UPDATE "Banner"
       SET "promoBannerGroupId" = group_id
     WHERE "placement" = 'MID';

    /*
     * Rewrite the stored homeConfig so its existing MID_BANNERS entry names the
     * group, PRESERVING ITS POSITION AND ITS `enabled` FLAG.
     *
     * jsonb_agg over WITH ORDINALITY rather than a path update, because the
     * entry's index differs per store — the whole point of the section config
     * is that merchants reorder it — so there is no fixed path to write to.
     * Ordinality is what keeps the rebuilt array in the merchant's order.
     *
     * A store whose homeConfig is NULL, is not an array, or contains no
     * MID_BANNERS entry is LEFT ALONE, and that is success, not a failed
     * backfill: reconciliation splices an enabled entry for the group, which is
     * the correct outcome for a store that never configured its homepage.
     */
    UPDATE "StoreSetting" s
       SET "homeConfig" = rebuilt.config
      FROM (
            SELECT st."id" AS setting_id,
                   jsonb_agg(
                       CASE
                           WHEN entry->>'key' = 'MID_BANNERS'
                           THEN entry || jsonb_build_object('groupId', group_id)
                           ELSE entry
                       END
                       ORDER BY ord
                   ) AS config
              FROM "StoreSetting" st,
                   LATERAL jsonb_array_elements(st."homeConfig") WITH ORDINALITY AS t(entry, ord)
             WHERE jsonb_typeof(st."homeConfig") = 'array'
             GROUP BY st."id"
           ) AS rebuilt
     WHERE s."id" = rebuilt.setting_id
       AND rebuilt.config @> '[{"key": "MID_BANNERS"}]'::jsonb;
END $$;
