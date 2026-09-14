-- Removes the Collection feature entirely.
--
-- Collections were a merchandising grouping — "Top selling", "Eid specials" —
-- independent of the category tree, added by align-admin-catalog-with-reference
-- as part of a deliberately additive foundation whose storefront half was left
-- as an open question ("Whether collections get storefront listing pages.
-- Explicitly out of scope here; the data will support it either way.").
--
-- That question is now answered: no. The storefront never rendered them. There
-- was no public endpoint to read them with — the router carried a blanket
-- checkAuth(OWNER, ADMIN) — no /collections route, and no component consumed
-- the membership data the product API was already projecting. What the admin
-- offered was a switch reading "Visible on the storefront" that changed nothing
-- anywhere, which is worse than an absent feature: it promises a behaviour that
-- does not exist.
--
-- The occasion-sale case collections were imagined for is served by Campaign,
-- which has the things a sale actually needs and collections never had: a
-- start/end window, a discount, a storefront placement, and a public endpoint.
-- Bundle deals cover the other grouping case. Keeping a third, inert grouping
-- alongside them was three half-answers to one question.
--
-- Data loss is real and intended: every collection and every membership goes.
-- Products themselves are untouched — the memberships were always the only
-- thing a collection owned, which is why deleting one never needed a
-- reassignment prompt. ProductCollection drops first; it is the dependent side.
--
-- NOTE: the DROP INDEX statements `prisma migrate dev` generates alongside a
-- migration have again been omitted. Those are the pg_trgm GIN indexes
-- (Product_name_trgm_idx, Product_sku_trgm_idx, Brand_name_trgm_idx) created by
-- raw SQL in 20260831000000_add_product_search_indexes and not modelled in
-- schema.prisma, which Prisma reads as drift on EVERY generated migration.
-- Dropping them would silently degrade ProductService.searchProducts to a
-- sequential scan. Expect to remove them again next time one is generated.
--
-- Written by hand rather than generated, which is the same discipline the
-- previous notes ask for by another route: nothing here needs Prisma to diff
-- anything, and not generating it is the surest way not to ship the DROPs.

-- DropForeignKey
ALTER TABLE "ProductCollection" DROP CONSTRAINT IF EXISTS "ProductCollection_productId_fkey";

-- DropForeignKey
ALTER TABLE "ProductCollection" DROP CONSTRAINT IF EXISTS "ProductCollection_collectionId_fkey";

-- DropTable
DROP TABLE IF EXISTS "ProductCollection";

-- DropTable
DROP TABLE IF EXISTS "Collection";
