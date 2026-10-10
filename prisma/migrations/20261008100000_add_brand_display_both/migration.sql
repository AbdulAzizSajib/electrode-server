-- Adds BOTH (logo with the wordmark beside it) to BrandDisplayMode.
--
-- Widens the two native ENUM columns on StoreSetting from ('TEXT','LOGO') to
-- ('TEXT','LOGO','BOTH'). BOTH is APPENDED, never inserted: MySQL stores an
-- ENUM by index, so appending is an in-place metadata change on InnoDB and the
-- stored TEXT and LOGO rows keep their meaning. See
-- openspec/changes/add-brand-display-both, design.md Decisions 1 and 2.
--
-- Additive only: no row changes value and the default stays TEXT, so nothing a
-- storefront shows today changes on deploy. Run this BEFORE the server code
-- that accepts BOTH, or a save of BOTH fails against the two-value column.
--
-- A DATABASE THAT ALREADY HAS THE THREE-VALUE COLUMNS (altered by `db push` or
-- by hand) does not need this run. Mark it applied instead, which runs no SQL:
--   npx prisma migrate resolve --applied 20261008100000_add_brand_display_both

-- AlterTable
ALTER TABLE `StoreSetting` MODIFY `headerBrandMode` ENUM('TEXT', 'LOGO', 'BOTH') NOT NULL DEFAULT 'TEXT',
    MODIFY `footerBrandMode` ENUM('TEXT', 'LOGO', 'BOTH') NOT NULL DEFAULT 'TEXT';
