-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "guestIp" TEXT,
ADD COLUMN     "isGuestOrder" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StoreSetting" ADD COLUMN     "maxGuestOrdersPerIpPerHour" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "maxPendingCodOrdersPerPhone" INTEGER NOT NULL DEFAULT 3;

-- CreateIndex
CREATE UNIQUE INDEX "Customer_phone_key" ON "Customer"("phone");

-- CreateIndex
CREATE INDEX "Order_guestIp_createdAt_idx" ON "Order"("guestIp", "createdAt");
