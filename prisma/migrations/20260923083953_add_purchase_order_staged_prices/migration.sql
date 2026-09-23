-- Adds `PurchaseOrderItem.stagedOfferPrice` and `stagedSellingPrice`: selling
-- prices a purchase order line PROPOSES for the item it names, applied by a
-- goods receipt rather than when the line is saved.
--
-- ADDITIVE AND NULLABLE, SO NO BACKFILL. Null means "this line has no opinion
-- about the selling price", which is exactly what every existing row means —
-- so the columns arrive already correct for every one of them, and a deploy of
-- this migration alone changes no behaviour. The server ships before any client
-- sends these fields, and `receivePurchaseOrder` finds null on every line and
-- behaves as it does today.
--
-- See openspec/changes/add-purchase-order-pricing, design.md Decisions 1 and 7.
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

-- AlterTable
ALTER TABLE "PurchaseOrderItem" ADD COLUMN     "stagedOfferPrice" DECIMAL(12,2),
ADD COLUMN     "stagedSellingPrice" DECIMAL(12,2);
