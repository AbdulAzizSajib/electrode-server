-- Merchant-editable integration credentials, encrypted at rest.
-- See openspec/changes/rename-courier-setting-to-integrations.
--
-- Two tables rather than one. `Integration` is the integration itself — its
-- enabled state and the unguessable publicId its webhook URL carries.
-- `IntegrationCredential` holds its secrets, one row per secret. The split is
-- because "is Steadfast enabled?" must have exactly one answer and Steadfast
-- holds two credentials; a flag on each credential row would give that question
-- two answers that can disagree. Same reasoning for publicId, which identifies
-- the integration in a callback URL.
--
-- `IntegrationCredential.value` is ALWAYS ciphertext (AES-256-GCM, written and
-- read only through src/app/lib/crypto.ts under INTEGRATION_ENCRYPTION_KEY).
-- Nothing may write that column directly — a plaintext value is refused on read
-- rather than honoured, so a shortcut fails loudly instead of silently
-- disabling encryption for that row.
--
-- Purely additive, no backfill. Existing shops keep dispatching because a boot
-- import copies STEADFAST_API_KEY / STEADFAST_SECRET_KEY /
-- STEADFAST_WEBHOOK_TOKEN out of the environment into these tables on first
-- start, filling only absent rows. Env can therefore fill a missing credential
-- but can never override one the merchant has entered.
--
-- `StoreSetting.integrationConfig` is the PUBLIC half of the same feature — the
-- Meta pixel id and CAPI test-mode flags, which the storefront must be able to
-- read. The CAPI access token deliberately does NOT go there: that row is served
-- by a public endpoint. Postgres constrains no Json column, so
-- store-setting.validation.ts is the only gate, as with every other Json column
-- on that table.
--
-- NOTE: the DROP INDEX statements `prisma migrate dev` generated alongside this
-- have again been removed. Those are the pg_trgm GIN indexes
-- (Product_name_trgm_idx, Product_sku_trgm_idx, Brand_name_trgm_idx) created by
-- raw SQL in 20260831000000_add_product_search_indexes and not modelled in
-- schema.prisma, which Prisma reads as drift on EVERY generated migration.
-- Dropping them would silently degrade ProductService.searchProducts to a
-- sequential scan. Expect to remove them again next time one is generated.
--
-- Generated with `--create-only` and edited BEFORE being applied, as the
-- previous two migrations' notes instruct. Keep using `--create-only` here: the
-- one time this was generated and applied in the same breath, the DROPs went
-- through and the three indexes had to be recreated by hand.

-- AlterTable
ALTER TABLE "StoreSetting" ADD COLUMN     "integrationConfig" JSONB;

-- CreateTable
CREATE TABLE "Integration" (
    "provider" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "publicId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "IntegrationCredential" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "lastFour" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Integration_publicId_key" ON "Integration"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationCredential_provider_kind_key" ON "IntegrationCredential"("provider", "kind");

-- AddForeignKey
ALTER TABLE "IntegrationCredential" ADD CONSTRAINT "IntegrationCredential_provider_fkey" FOREIGN KEY ("provider") REFERENCES "Integration"("provider") ON DELETE CASCADE ON UPDATE CASCADE;
