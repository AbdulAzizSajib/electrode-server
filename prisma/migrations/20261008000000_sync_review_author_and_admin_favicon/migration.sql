-- Brings the migration history level with schema.prisma.
--
-- Three schema changes reached `prisma/schema/` without a migration, so a
-- database built from migrations alone (a new shop, a fresh `migrate deploy`)
-- came up without them, and Prisma's default select of every StoreSetting
-- column then failed on the missing `adminFaviconUrl` for every page:
--
--   Review.customerId      NOT NULL -> NULL   (Review.prisma: `String?`)
--   Review.authorName      added, VARCHAR(255) NULL
--   StoreSetting.adminFaviconUrl  added, VARCHAR(512) NULL
--
-- Additive only: no DROP, and both new columns are nullable, so existing rows
-- need no default. The foreign key on Review.customerId is unchanged.
--
-- A DATABASE THAT ALREADY HAS THESE COLUMNS (one updated by `db push` or by
-- hand) must NOT run this — MySQL would refuse the duplicate column. Mark it
-- applied instead, which runs no SQL:
--   npx prisma migrate resolve --applied 20261008000000_sync_review_author_and_admin_favicon

-- AlterTable
ALTER TABLE `Review` MODIFY `customerId` VARCHAR(191) NULL,
    ADD COLUMN `authorName` VARCHAR(255) NULL;

-- AlterTable
ALTER TABLE `StoreSetting` ADD COLUMN `adminFaviconUrl` VARCHAR(512) NULL;
