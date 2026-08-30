-- `image` becomes nullable: it is required only for an IMAGE banner (enforced in
-- banner.validation.ts). A DYNAMIC banner can render over a bgColor with no
-- artwork, so a NOT NULL column would reject a request zod accepts.
--
-- The `placement` DROP DEFAULT is intentional and was generated from schema
-- drift: the 'HEADER' default added in 20260830044311 existed only to backfill
-- pre-existing rows. That backfill has run, and the Prisma model deliberately
-- carries no @default(HEADER) — the API requires `placement` on create — so the
-- column default is dropped now that it has served its purpose.

-- AlterTable
ALTER TABLE "Banner" ALTER COLUMN "image" DROP NOT NULL,
ALTER COLUMN "placement" DROP DEFAULT;
