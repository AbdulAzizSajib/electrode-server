-- Hand-edited after `prisma migrate dev --create-only`.
--
-- Prisma generated `placement` as NOT NULL with no default, which fails on a
-- non-empty Banner table. A DEFAULT 'HEADER' is added below purely as a
-- backfill device for pre-existing rows: the Prisma model deliberately has no
-- `@default(HEADER)`, and the API still requires `placement` on create.

-- CreateEnum
CREATE TYPE "BannerPlacement" AS ENUM ('HEADER', 'MID', 'FOOTER', 'SIDEBAR', 'POPUP');

-- CreateEnum
CREATE TYPE "BannerType" AS ENUM ('IMAGE', 'DYNAMIC');

-- DropIndex
DROP INDEX "Banner_sortOrder_idx";

-- AlterTable
ALTER TABLE "Banner" ADD COLUMN     "bgColor" TEXT,
ADD COLUMN     "buttonText" TEXT DEFAULT 'Shop Now',
ADD COLUMN     "description" TEXT,
ADD COLUMN     "discountPrice" DECIMAL(10,2),
ADD COLUMN     "placement" "BannerPlacement" NOT NULL DEFAULT 'HEADER',
ADD COLUMN     "price" DECIMAL(10,2),
ADD COLUMN     "productId" TEXT,
ADD COLUMN     "textColor" TEXT,
ADD COLUMN     "type" "BannerType" NOT NULL DEFAULT 'IMAGE',
ALTER COLUMN "title" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Banner_placement_idx" ON "Banner"("placement");

-- CreateIndex
CREATE INDEX "Banner_placement_sortOrder_idx" ON "Banner"("placement", "sortOrder");

-- AddForeignKey
ALTER TABLE "Banner" ADD CONSTRAINT "Banner_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
