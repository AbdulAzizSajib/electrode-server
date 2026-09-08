-- Courier identity on Shipment, for dispatching orders to Steadfast and reading
-- their delivery state back.
--
-- Additive and backward compatible. Every existing shipment keeps working with
-- all four columns null, and null is exactly what "entered by hand" means here:
-- the presence of consignmentId is what marks a shipment as courier-owned, which
-- is what shipment.service.ts checks before refusing a manual write to the
-- fields the courier now owns.
--
-- No backfill is possible or wanted. Shipments recorded before this change were
-- never dispatched through the API and have no consignment to point at.
--
-- courierStatus stores Steadfast's `delivery_status` verbatim rather than mapped
-- onto ShipmentStatus. The two vocabularies do not line up — eleven values
-- against eight, and any mapping collapses `delivered_approval_pending` into
-- `delivered` when only the second means the merchant has been paid.
-- See openspec/changes/add-steadfast-courier-integration, design.md Decision 3.
--
-- The unique constraint on consignmentId is safe on existing data: every row
-- gets NULL, and Postgres treats NULLs as distinct in a unique index, so any
-- number of them coexist. It stops one consignment being recorded against two
-- orders.
--
-- NOTE: the DROP INDEX statements `prisma migrate diff` generated alongside this
-- have again been removed. Those are the pg_trgm GIN indexes
-- (Product_name_trgm_idx, Product_sku_trgm_idx, Brand_name_trgm_idx) created by
-- raw SQL in 20260831000000_add_product_search_indexes and not modelled in
-- schema.prisma, which Prisma reads as drift on EVERY generated migration.
-- Dropping them would silently degrade ProductService.searchProducts to a
-- sequential scan. Expect to remove them again next time one is generated.

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "consignmentId" TEXT,
ADD COLUMN     "courierInvoice" TEXT,
ADD COLUMN     "courierStatus" TEXT,
ADD COLUMN     "courierSyncedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_consignmentId_key" ON "Shipment"("consignmentId");

-- CreateIndex
-- Serves the sync job's "consignments not yet terminal" selection.
CREATE INDEX "Shipment_courierStatus_idx" ON "Shipment"("courierStatus");
