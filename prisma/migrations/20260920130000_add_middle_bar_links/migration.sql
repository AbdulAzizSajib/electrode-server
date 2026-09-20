-- Adds `StoreSetting.middleBarLinks` and moves an existing Track Order link
-- into it, out of the announcement bar.
--
-- WHY THE MOVE IS PART OF THE MIGRATION rather than a script: the link would
-- otherwise render in BOTH places between deploying and remembering to run a
-- cleanup, and "remembering" is not a mechanism. Running here means it happens
-- exactly once, on the normal migration path, for every environment.
--
-- NOTE — the trigram index hazard (carried forward from
-- 20260916183105_add_hot_path_indexes, which is where the full account lives):
-- `Product_name_trgm_idx`, `Product_sku_trgm_idx` and `Brand_name_trgm_idx`
-- were raw-SQL indexes Prisma read as drift and emitted DROP INDEX for in every
-- generated migration. That migration declared them in Product.prisma and
-- Brand.prisma, so generated migrations should no longer try to drop them —
-- but CHECK EVERY GENERATED MIGRATION ANYWAY. Committing those drops silently
-- degrades ProductService.searchProducts to a sequential scan, and nothing
-- fails loudly when it happens. This file contains no DROP INDEX.

-- AlterTable
ALTER TABLE "StoreSetting" ADD COLUMN     "middleBarLinks" JSONB;

-- Move any announcement-bar link targeting /track-order into `middleBarLinks`.
--
-- MATCHED ON `href`, NOT `label`: a merchant may well have renamed it "Track my
-- parcel". The target is what identifies the link; the label is theirs and is
-- carried across untouched, along with the icon.
--
-- RE-RUNNABLE. A second run finds nothing to move, because the WHERE clause
-- requires a `/track-order` entry still present in `announcementBar.links`.
-- This matters beyond tidiness: the spec requires that a merchant who DELETES
-- the migrated entry does not silently get it back, and an operator restoring a
-- database and re-running migrations is an ordinary event.
--
-- REMOVAL IS UNCONDITIONAL; ONLY THE APPEND IS GUARDED. A shop that already has
-- a `/track-order` entry in `middleBarLinks` — because a merchant added one by
-- hand before this ran — still gets the announcement-bar copy removed, it just
-- does not get a second entry. Skipping such a row wholesale would leave the
-- link rendering in both rows at once, which is the one outcome this migration
-- exists to prevent.
--
-- GUARDED on shape, not assumed. A row whose `announcementBar` is NULL, whose
-- `links` key is absent, or whose `links` is not an array is left completely
-- alone rather than rewritten into a shape the Zod schema would later reject —
-- Postgres does not constrain these columns, so this statement is as close to
-- the gate as the data gets.
UPDATE "StoreSetting" AS s
SET
    "middleBarLinks" = COALESCE(
        CASE
            WHEN jsonb_typeof(s."middleBarLinks") = 'array' THEN s."middleBarLinks"
            ELSE '[]'::jsonb
        END,
        '[]'::jsonb
    ) || COALESCE(
        -- The matched entry, reduced to this list's shape: it has no `source`,
        -- which is an announcement-bar concept (see StoreSetting.prisma).
        --
        -- Skipped — leaving `|| '[]'` — when this shop already has a
        -- `/track-order` entry, so the removal below still runs but no second
        -- entry is created.
        (
            SELECT jsonb_agg(
                jsonb_strip_nulls(
                    jsonb_build_object(
                        'icon', link -> 'icon',
                        'label', link -> 'label',
                        'href', link -> 'href'
                    )
                )
            )
            FROM jsonb_array_elements(s."announcementBar" -> 'links') AS link
            WHERE link ->> 'href' = '/track-order'
              AND NOT EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements(
                      CASE
                          WHEN jsonb_typeof(s."middleBarLinks") = 'array' THEN s."middleBarLinks"
                          ELSE '[]'::jsonb
                      END
                  ) AS existing
                  WHERE existing ->> 'href' = '/track-order'
              )
        ),
        '[]'::jsonb
    ),
    "announcementBar" = jsonb_set(
        s."announcementBar",
        '{links}',
        COALESCE(
            (
                SELECT jsonb_agg(link)
                FROM jsonb_array_elements(s."announcementBar" -> 'links') AS link
                WHERE link ->> 'href' IS DISTINCT FROM '/track-order'
            ),
            '[]'::jsonb
        )
    )
WHERE
    jsonb_typeof(s."announcementBar") = 'object'
    AND jsonb_typeof(s."announcementBar" -> 'links') = 'array'
    -- Something in the bar to move. This is also what makes the statement
    -- idempotent: after one run no row matches, because the entry is gone from
    -- `announcementBar.links`.
    AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(s."announcementBar" -> 'links') AS link
        WHERE link ->> 'href' = '/track-order'
    );
