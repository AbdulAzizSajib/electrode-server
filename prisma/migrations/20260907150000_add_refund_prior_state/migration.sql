-- Records what a refund overwrote, so voiding it can put things back exactly.
-- See openspec/changes/add-admin-correction-paths (design.md Decision 5).
--
-- Issuing a refund is a compound action: it moves the settled Payment to
-- REFUNDED/PARTIALLY_REFUNDED and completes the ReturnRequest it settles.
-- Voiding has to reverse both, and restoring a FIXED status would be wrong — a
-- return already COMPLETED for its own reasons must not be reopened, and a
-- payment refunded from PENDING must not come back as PAID. Nothing recorded
-- the prior values until now: createRefund wrote no AuditLog at all, and
-- AuditLogService swallows its own write failures by design, so even once it
-- does an entry is not guaranteed to exist.
--
-- Purely additive and nullable, so it is safe on a live Refund table: no
-- rewrite, no default to backfill, no lock beyond the catalog update.
--
-- DELIBERATELY NOT BACKFILLED. For refunds created before this column the prior
-- statuses are genuinely unknown — the writes that would have revealed them
-- were never made. NULL means "unknown", and voidRefund treats it as "nothing
-- to restore" rather than guessing a status and silently reopening a return or
-- reviving a payment. Those refunds can still be voided; the operator restores
-- the related records by hand, which is what they would have had to do anyway.
--
-- NOTE: any DROP INDEX statements `prisma migrate dev` generates alongside this
-- must be removed before committing. Those are the pg_trgm GIN indexes created
-- by raw SQL in 20260831000000_add_product_search_indexes and not modelled in
-- schema.prisma, which Prisma reads as drift on EVERY generated migration.
-- Dropping them would silently degrade ProductService.searchProducts to a
-- sequential scan.

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "priorPaymentStatus" "PaymentStatus",
ADD COLUMN     "priorReturnStatus" "ReturnStatus",
ADD COLUMN     "completedReturnRequestId" TEXT;
