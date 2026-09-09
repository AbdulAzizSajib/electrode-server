-- Courier provider selection: the shop chooses which courier it dispatches
-- through, and every consignment records which courier created it.
--
-- Purely additive in effect. Both new columns default to STEADFAST, which is
-- what every existing row already is — there is no backfill to run and no
-- deployment step. An installation that changes no configuration behaves
-- identically after this migration.
--
-- StoreSetting.courierProvider holds the SELECTION only. The credentials stay
-- in the environment: this row is served by a public endpoint, so a secret on
-- it is one careless field selection away from being published. An enum naming
-- a courier grants nothing to whoever reads it.
--
-- Shipment.courierProvider is what reconciliation, webhook matching and return
-- requests route on — never the setting. The setting says what the shop
-- dispatches through now; this says who is actually carrying THIS parcel.
-- Without it, changing the setting would strand every parcel in flight: the
-- sync job would poll the new courier's API for a consignment id that courier
-- never issued, 404 per consignment forever, and leave the orders sitting in
-- SHIPPED with nothing to explain why.
--
-- The consignmentId unique constraint becomes composite. It was globally unique
-- while Steadfast was the only courier; that stops being safe the moment a
-- second one is registered, because each courier issues ids from its own space
-- and two providers can legitimately both issue "1234567". Worse than the
-- rejected insert, a webhook matching on the id alone would apply one courier's
-- status to another courier's parcel. Postgres treats NULLs as distinct, so
-- hand-entered shipments stay unconstrained exactly as they were before.
--
-- See openspec/changes/add-courier-provider-selection, design.md Decisions 3, 4
-- and 8.
--
-- NOTE: the DROP INDEX statements `prisma migrate diff` generated alongside this
-- have again been removed — the pg_trgm GIN indexes from
-- 20260831000000_add_product_search_indexes, which Prisma reads as drift on
-- every generated migration. Dropping them would silently degrade
-- ProductService.searchProducts to a sequential scan. The one DROP INDEX kept
-- below is deliberate and unrelated: it is the single-column consignment
-- constraint being replaced by the composite one.

-- CreateEnum
CREATE TYPE "CourierProvider" AS ENUM ('STEADFAST', 'MANUAL');

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "courierProvider" "CourierProvider" NOT NULL DEFAULT 'STEADFAST';

-- AlterTable
ALTER TABLE "StoreSetting" ADD COLUMN     "courierProvider" "CourierProvider" NOT NULL DEFAULT 'STEADFAST';

-- DropIndex
-- Deliberate: replaced by the composite unique below, which scopes consignment
-- uniqueness to the provider that issued the id.
DROP INDEX "Shipment_consignmentId_key";

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_courierProvider_consignmentId_key" ON "Shipment"("courierProvider", "consignmentId");
