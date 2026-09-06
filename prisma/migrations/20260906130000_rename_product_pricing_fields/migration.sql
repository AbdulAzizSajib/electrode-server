-- Hand-written, NOT generated. `prisma migrate dev` was run with --create-only
-- and its output discarded, because what it generated was destructive:
--
--   • You are about to drop the column `compareAtPrice` on the `Product` table,
--     which still contains 2 non-null values.
--   • You are about to drop the column `price` on the `Product` table, ...
--   • Step 3 Added the required column `offerPrice` to the `Product` table
--     without a default value.
--
-- Prisma cannot infer that a dropped column and an added one are the same
-- column under a new name, so it emits DROP + ADD. Applying that would have set
-- every price in the catalogue to NULL. These are renames, and a rename is what
-- this file does.
--
-- ALTER TABLE ... RENAME COLUMN carries indexes, constraints and data across
-- untouched, and is a catalog-only operation — no table rewrite, so it stays
-- fast on a large Product table.
--
-- The mapping, on both Product and ProductVariant:
--
--   costPrice      -> purchasePrice   supplier cost, admin-only
--   compareAtPrice -> sellingPrice    regular price, shown struck through
--   price          -> offerPrice      what the shopper is actually charged
--
-- See openspec/changes/rename-product-pricing-fields/design.md, Decisions 1-2.
--
-- Rollback is the same six statements with the names swapped. That holds only
-- while this migration contains nothing but the renames — do not add unrelated
-- schema changes to this file.

-- Product
ALTER TABLE "Product" RENAME COLUMN "costPrice" TO "purchasePrice";
ALTER TABLE "Product" RENAME COLUMN "compareAtPrice" TO "sellingPrice";
ALTER TABLE "Product" RENAME COLUMN "price" TO "offerPrice";

-- ProductVariant
ALTER TABLE "ProductVariant" RENAME COLUMN "costPrice" TO "purchasePrice";
ALTER TABLE "ProductVariant" RENAME COLUMN "compareAtPrice" TO "sellingPrice";
ALTER TABLE "ProductVariant" RENAME COLUMN "price" TO "offerPrice";
