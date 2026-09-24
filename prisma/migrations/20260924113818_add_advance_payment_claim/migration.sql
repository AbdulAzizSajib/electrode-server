-- Adds the manual advance-payment claim to `Payment`: the shopper sends the
-- delivery charge (or the whole total) before the order ships, types the sender
-- number and transaction reference into checkout, and staff verify it against
-- their own bKash/Nagad/bank statement before the order may advance.
--
-- ALL SIX COLUMNS ARE NULLABLE AND THERE IS NO BACKFILL, deliberately. No row
-- in this table is an advance claim on the day this deploys, so every existing
-- payment reads as "not a claim" — which is what it is. A COD row records money
-- collected at the door and has nothing to verify.
--
-- The columns are typed rather than keys inside the unused `gatewayResponse`
-- Json column. Postgres does not constrain Json, so the values deciding whether
-- an order may ship would sit outside the type system, and no query could
-- answer "every claim from this sender number" — the question actually asked
-- when one shopper is suspected of fabricating references.
--
-- `Payment_status_createdAt_idx` serves the admin's "claims awaiting a
-- decision" queue, which reads one status across every order. Without it that
-- is a sequential scan growing with lifetime order volume rather than with the
-- size of the queue.
--
-- `verifiedByUserId` is ON DELETE SET NULL: deleting a staff account must not
-- delete the record that a payment was verified, only who verified it.
--
-- See openspec/changes/add-advance-payment-checkout, design.md Decision 4.
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
ALTER TABLE "Payment" ADD COLUMN     "paidToAccountId" TEXT,
ADD COLUMN     "paidToAccountSnapshot" JSONB,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "senderIdentifier" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedByUserId" TEXT;

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
