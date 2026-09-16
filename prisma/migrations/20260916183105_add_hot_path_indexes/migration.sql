-- Indexes for the storefront's hot read paths. Additive only: no table, column
-- or row changes.
--
-- 1. Trigram (GIN) indexes for text search.
--    `Product_name_trgm_idx`, `Product_sku_trgm_idx` and `Brand_name_trgm_idx`
--    first came from raw SQL in 20260831000000_add_product_search_indexes and
--    were never modelled in the schema. Prisma therefore generated DROP INDEX
--    statements for them in every later migration; those were deleted by hand
--    each time until 20260915093244_change_cuid_to_uuid_7 let them through, and
--    search has scanned the whole catalog since. They are recreated here AND
--    declared in Product.prisma / Brand.prisma, so no generated migration will
--    try to drop them again.
--
--    `description` and `shortDescription` are new: the listing's `?searchTerm=`
--    ORs them with `name`, and one unindexed branch of an OR forces a full scan
--    no matter how many of the others are indexed.
--
-- 2. `CampaignProduct.productId` — every listing, product page, cart, quote and
--    checkout resolves campaign prices with `productId IN (...)`, which the
--    existing unique index on (campaignId, productId) cannot serve.
--
-- 3. `StockMovement.referenceId` — cancellation and delivery read an order's
--    movements back by it, on a table that grows with every sale.

-- The extension already exists from 20260831000000; stated again so this file
-- stands on its own against a database restored without it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "Brand_name_trgm_idx" ON "Brand" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "CampaignProduct_productId_idx" ON "CampaignProduct"("productId");

-- CreateIndex
CREATE INDEX "Product_name_trgm_idx" ON "Product" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Product_sku_trgm_idx" ON "Product" USING GIN ("sku" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Product_description_trgm_idx" ON "Product" USING GIN ("description" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Product_shortDescription_trgm_idx" ON "Product" USING GIN ("shortDescription" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "StockMovement_referenceId_idx" ON "StockMovement"("referenceId");
