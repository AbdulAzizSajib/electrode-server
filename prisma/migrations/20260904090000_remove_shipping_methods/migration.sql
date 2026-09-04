-- Removes ShippingMethod, whose flat price was superseded by ShippingRule in
-- 20260903120000_align_admin_catalog. The two had been contradicting each other:
-- quoteShipping consults the flat price only when NO line carries a shipping
-- rule, and every product carries one — so a shopper picking "Cash In Delivery -
-- Outside Dhaka, Tk 160" was actually charged the matched place's Tk 80.
-- Delivery is now priced solely from a product's shipping rule.
-- See openspec/changes/remove-shipping-methods design.md.
--
-- The two rows being dropped with the table are recorded in that change's
-- proposal for re-entry as places on a shipping rule:
--   Cash In Delivery - Inside Dhaka   Tk 80
--   Cash In Delivery - Outside Dhaka  Tk 160
-- Nothing referenced them: no order has been placed and no Shipment carried a
-- shippingMethodId, so no charged amount changes.
--
-- Shipment keeps `carrier` (free text), which is what actually identifies who
-- delivered a parcel; only the reference to a stored method goes.

-- NOTE: `prisma migrate diff` again generated three DROP INDEX statements here
-- for Product_name_trgm_idx, Product_sku_trgm_idx and Brand_name_trgm_idx, and
-- they have again been removed. Those are pg_trgm GIN indexes created by raw
-- SQL in 20260831000000_add_product_search_indexes and not modelled in
-- schema.prisma, so Prisma reads them as drift on EVERY generated migration.
-- Dropping them would silently degrade ProductService.searchProducts to a
-- sequential scan. Expect to remove them again next time.

-- DropForeignKey
ALTER TABLE "Shipment" DROP CONSTRAINT "Shipment_shippingMethodId_fkey";

-- DropIndex
DROP INDEX "Shipment_shippingMethodId_idx";

-- AlterTable
ALTER TABLE "Shipment" DROP COLUMN "shippingMethodId";

-- DropTable
DROP TABLE "ShippingMethod";
