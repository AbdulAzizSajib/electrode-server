-- Order provenance: where the customer came from, who recorded the order, and
-- why a discount was given.
-- See openspec/changes/add-manual-orders-and-item-images.
--
-- Purely additive. `channel` is NOT NULL with a default, which is safe here
-- because the default is a FACT about every existing row rather than a
-- placeholder: the manual order path did not exist before this migration, so
-- every order already in the table genuinely was placed by a shopper on the
-- storefront. No backfill script, and nothing to reconcile afterwards.
--
-- `createdByUserId` is nullable and stays that way. The null is the signal —
-- it means nobody placed this order on the customer's behalf, i.e. they placed
-- it themselves. ON DELETE SET NULL, not CASCADE: deleting a staff account must
-- never delete the orders that person took.
--
-- NOTE: the DROP INDEX statements `prisma migrate dev` generated alongside this
-- have again been removed. Those are the pg_trgm GIN indexes
-- (Product_name_trgm_idx, Product_sku_trgm_idx, Brand_name_trgm_idx) created by
-- raw SQL in 20260831000000_add_product_search_indexes and not modelled in
-- schema.prisma, which Prisma reads as drift on EVERY generated migration.
-- Dropping them would silently degrade ProductService.searchProducts to a
-- sequential scan. Expect to remove them again next time one is generated.
--
-- Unlike previous times, this one was generated AND APPLIED before the DROPs
-- were noticed, so the indexes really were dropped from the development
-- database and had to be recreated by hand. `migrate dev` applies in the same
-- breath as it generates — use `--create-only` when a migration is expected to
-- trip this, and edit before applying.

-- CreateEnum
CREATE TYPE "OrderChannel" AS ENUM ('WEBSITE', 'WHATSAPP', 'MESSENGER', 'PHONE', 'IN_STORE', 'OTHER');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "channel" "OrderChannel" NOT NULL DEFAULT 'WEBSITE',
ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "discountReason" TEXT;

-- CreateIndex
CREATE INDEX "Order_channel_idx" ON "Order"("channel");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
