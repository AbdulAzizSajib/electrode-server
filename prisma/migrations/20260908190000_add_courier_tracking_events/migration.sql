-- Courier tracking history: one row per notification Steadfast sends about a
-- consignment, both `delivery_status` changes and `tracking_update` messages.
--
-- A new table rather than a `lastTrackingMessage` column on Shipment. Keeping
-- only the newest value answers "where is the parcel now" while destroying
-- "where has it been", which is the question a late delivery actually raises.
--
-- dedupeKey is unique because webhook deliveries must be assumed to repeat.
-- Steadfast may re-deliver a notification, and an appended duplicate would show
-- the operator a timeline that stutters. The key is built from shipment + type +
-- the courier's own timestamp + a bounded slice of the message, so a genuine
-- repeat collides here and is skipped. Enforcing it with a constraint rather
-- than a read-then-write matters: two concurrent deliveries of the same
-- notification would both pass a read check.
--
-- It is a stored column rather than a unique index across those four fields
-- directly because trackingMessage is unbounded text, and a btree unique index
-- over it would fail on a long value at insert time.
--
-- Purely additive. Nothing reads this table until the webhook endpoint exists.
-- See openspec/changes/add-steadfast-courier-integration, design.md Decision 11.
--
-- NOTE: the DROP INDEX statements `prisma migrate diff` generated alongside this
-- have again been removed — the pg_trgm GIN indexes from
-- 20260831000000_add_product_search_indexes, which Prisma reads as drift on
-- every generated migration. Dropping them would silently degrade
-- ProductService.searchProducts to a sequential scan.

-- CreateTable
CREATE TABLE "CourierTrackingEvent" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "notificationType" TEXT NOT NULL,
    "status" TEXT,
    "trackingMessage" TEXT,
    "codAmount" DECIMAL(12,2),
    "deliveryCharge" DECIMAL(12,2),
    "courierUpdatedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dedupeKey" TEXT NOT NULL,

    CONSTRAINT "CourierTrackingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourierTrackingEvent_dedupeKey_key" ON "CourierTrackingEvent"("dedupeKey");

-- CreateIndex
-- Serves an order's tracking timeline, read oldest-to-newest per shipment.
CREATE INDEX "CourierTrackingEvent_shipmentId_receivedAt_idx" ON "CourierTrackingEvent"("shipmentId", "receivedAt");

-- AddForeignKey
ALTER TABLE "CourierTrackingEvent" ADD CONSTRAINT "CourierTrackingEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
