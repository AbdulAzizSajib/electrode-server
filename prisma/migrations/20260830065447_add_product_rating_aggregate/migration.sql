-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "averageRating" DECIMAL(3,2) NOT NULL DEFAULT 0,
ADD COLUMN     "reviewCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "StoreSetting" ADD COLUMN     "aboutText" TEXT,
ADD COLUMN     "announcementBar" JSONB,
ADD COLUMN     "copyrightText" TEXT,
ADD COLUMN     "footerColumns" JSONB,
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "mainNav" JSONB,
ADD COLUMN     "newsletter" JSONB,
ADD COLUMN     "siteNameAccent" TEXT,
ADD COLUMN     "socialLinks" JSONB;

-- CreateIndex
CREATE INDEX "Product_averageRating_idx" ON "Product"("averageRating");
