-- Trigram matching for product search (see openspec/changes/add-product-search-api).
-- Prisma's schema language cannot express an extension or an operator-class
-- index, so this migration is hand-written.

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
-- The search predicates are `LIKE '%term%'` and the trigram `%` operator.
-- Neither can use an ordinary B-tree, so without these the endpoint degrades
-- to a full scan as the catalog grows — with no warning in between.
CREATE INDEX IF NOT EXISTS "Product_name_trgm_idx" ON "Product" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_sku_trgm_idx" ON "Product" USING gin ("sku" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Brand_name_trgm_idx" ON "Brand" USING gin ("name" gin_trgm_ops);
