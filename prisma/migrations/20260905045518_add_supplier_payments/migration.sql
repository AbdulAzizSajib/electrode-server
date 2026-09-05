-- Adds the storage behind supplier payments: money paid OUT to a supplier
-- against a purchase order. See openspec/changes/add-admin-reports-section.
--
-- Purely additive: one new enum and one new table. No existing table, column
-- or enum is altered, so a running server is unaffected until the code that
-- reads this ships. PurchaseOrder.amountPaid / balanceDue are deliberately NOT
-- columns here — they are computed from these rows on read (design decision
-- 11), so there is no denormalized total that can drift.
--
-- SupplierPaymentMethod is separate from PaymentMethod on purpose: that enum
-- describes money coming IN and carries COD/STRIPE/PAYPAL while lacking
-- CASH/CHEQUE. Two enums make "COD is not a supplier payment method" something
-- Postgres refuses rather than something a service filter has to remember.
--
-- supplierId is denormalized from PurchaseOrder.supplierId and written by the
-- service, never from a request body — it lets the Payment history UNION
-- filter by supplier without joining through PurchaseOrder on every row.
--
-- NOTE: `prisma migrate dev` again generated three DROP INDEX statements here
-- for Product_name_trgm_idx, Product_sku_trgm_idx and Brand_name_trgm_idx, and
-- they have again been removed — exactly as every migration since
-- 20260903071459_add_product_option_types has predicted. Those are pg_trgm GIN
-- indexes created by raw SQL in 20260831000000_add_product_search_indexes and
-- not modelled in schema.prisma, so Prisma reads them as drift on EVERY
-- generated migration. Dropping them would silently degrade
-- ProductService.searchProducts to a sequential scan. Expect to remove them
-- again next time.

-- CreateEnum
CREATE TYPE "SupplierPaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CHEQUE', 'BKASH', 'NAGAD', 'ROCKET', 'CARD', 'OTHER');

-- CreateTable
CREATE TABLE "SupplierPayment" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "SupplierPaymentMethod" NOT NULL,
    "reference" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierPayment_purchaseOrderId_idx" ON "SupplierPayment"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "SupplierPayment_supplierId_idx" ON "SupplierPayment"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierPayment_paidAt_idx" ON "SupplierPayment"("paidAt");

-- CreateIndex
CREATE INDEX "SupplierPayment_method_idx" ON "SupplierPayment"("method");

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
