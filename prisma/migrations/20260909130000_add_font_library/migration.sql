-- Font library: the merchant-managed catalogue of Google Fonts that the
-- storefront and admin-panel font pickers select from.
--
-- Purely additive. One new table, no column added to an existing one, no
-- backfill. An installation that adds no fonts and changes no setting behaves
-- identically after this migration — the storefront keeps rendering whatever
-- StoreSetting.theme.font already says.
--
-- `Font.url` holds a stylesheet address rebuilt by parseGoogleFontEmbed from
-- validated components, never a substring of merchant input. Postgres cannot
-- express that, so the constraint lives in the service; this comment is here
-- so a future migration does not treat the column as free text.
--
-- `family` is UNIQUE because two rows for one typeface would render the same
-- card twice in the picker. The service rejects duplicates case-insensitively
-- before insert, which is what makes the check non-racy; this constraint is
-- the backstop, not the primary gate.
--
-- The SELECTION is deliberately NOT a foreign key to this table. It stays a
-- denormalised { family, url } copy inside the StoreSetting.theme JSON blob,
-- so the storefront read path is untouched and a stale selection still renders
-- a real typeface rather than nothing. That is why deleting a row is refused
-- with 409 while it is selected — see font.service.ts and
-- openspec/changes/add-font-library-and-admin-font, design.md Decisions 1, 2
-- and 5.
--
-- NOTE: the DROP INDEX statements `prisma migrate diff` generated alongside this
-- have again been removed — the pg_trgm GIN indexes from
-- 20260831000000_add_product_search_indexes, which Prisma reads as drift on
-- every generated migration because they cannot be expressed in schema.prisma.
-- Dropping them would silently degrade ProductService.searchProducts to a
-- sequential scan. This migration keeps no DROP INDEX of its own.

-- CreateTable
CREATE TABLE "Font" (
    "id" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Font_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Font_family_key" ON "Font"("family");

-- CreateIndex
CREATE INDEX "Font_family_idx" ON "Font"("family");
