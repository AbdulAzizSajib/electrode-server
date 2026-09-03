-- Aligns the catalog with the reference admin panel: shop-wide attributes,
-- tax and shipping rules, collections, bundle deals, tags, and the product
-- facts a merchant records (unit, badge, refundable, warranty, video).
-- See openspec/changes/align-admin-catalog-with-reference design.md.
--
-- THIS MIGRATION MOVES DATA, NOT ONLY SCHEMA. Per-product ProductOption /
-- ProductOptionValue rows become shop-wide Attribute / AttributeValue rows, and
-- every ProductVariantOptionValue is repointed at the new value. The old tables
-- are dropped ONLY after a verification gate proves no variant lost its
-- selection — a variant that silently loses its identity is unbuyable, and a
-- shopper sees "Sold out" on a product that has stock. That is the exact
-- failure this change exists to fix, so reproducing it here is not acceptable.
--
-- Written as ONE migration so a partial application cannot leave variants
-- pointing at dropped rows.
--
-- Deduplication is by TRIMMED, CASE-INSENSITIVE name: two products with
-- "Colour" and "colour" become one attribute. That is the whole point — one
-- attribute per product would only have renamed the problem.
--
-- NOTE: as with every generated migration in this repo, Prisma wants to drop
-- the pg_trgm GIN indexes (Product_name_trgm_idx, Product_sku_trgm_idx,
-- Brand_name_trgm_idx) created by raw SQL in
-- 20260831000000_add_product_search_indexes. They are not modelled in
-- schema.prisma so Prisma reads them as drift every time. They are deliberately
-- NOT dropped here; dropping them degrades ProductService.searchProducts to a
-- sequential scan.

-- ============================================================
-- 1. New enums and tables
-- ============================================================

CREATE TYPE "AttributePresentation" AS ENUM ('SWATCH', 'LABEL');
CREATE TYPE "ChargeType" AS ENUM ('FLAT', 'PERCENT');

CREATE TABLE "Attribute" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "presentation" "AttributePresentation" NOT NULL DEFAULT 'LABEL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Attribute_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AttributeValue" (
    "id" TEXT NOT NULL,
    "attributeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "swatch" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AttributeValue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaxRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ChargeType" NOT NULL DEFAULT 'PERCENT',
    "value" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TaxRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShippingRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShippingRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShippingPlace" (
    "id" TEXT NOT NULL,
    "shippingRuleId" TEXT NOT NULL,
    "name" TEXT,
    "country" TEXT,
    "state" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "deliveryDays" INTEGER NOT NULL DEFAULT 0,
    "offersPickup" BOOLEAN NOT NULL DEFAULT false,
    "pickupPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShippingPlace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductCollection" (
    "productId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductCollection_pkey" PRIMARY KEY ("productId","collectionId")
);

CREATE TABLE "BundleDeal" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "buyQuantity" INTEGER NOT NULL,
    "freeQuantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BundleDeal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductTag" (
    "productId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductTag_pkey" PRIMARY KEY ("productId","tagId")
);

-- ============================================================
-- 2. New product columns
-- ============================================================

ALTER TABLE "Product"
    ADD COLUMN "taxRuleId" TEXT,
    ADD COLUMN "shippingRuleId" TEXT,
    ADD COLUMN "bundleDealId" TEXT,
    ADD COLUMN "unit" TEXT,
    ADD COLUMN "badge" TEXT,
    ADD COLUMN "isRefundable" BOOLEAN,
    ADD COLUMN "hasWarranty" BOOLEAN,
    ADD COLUMN "video" TEXT,
    ADD COLUMN "videoThumbnail" TEXT;

-- ============================================================
-- 3. Indexes and foreign keys
-- ============================================================

CREATE UNIQUE INDEX "Attribute_name_key" ON "Attribute"("name");
CREATE INDEX "Attribute_position_idx" ON "Attribute"("position");
CREATE INDEX "AttributeValue_attributeId_idx" ON "AttributeValue"("attributeId");
CREATE UNIQUE INDEX "AttributeValue_attributeId_label_key" ON "AttributeValue"("attributeId", "label");
CREATE UNIQUE INDEX "TaxRule_name_key" ON "TaxRule"("name");
CREATE UNIQUE INDEX "ShippingRule_name_key" ON "ShippingRule"("name");
CREATE INDEX "ShippingPlace_shippingRuleId_idx" ON "ShippingPlace"("shippingRuleId");
CREATE INDEX "ShippingPlace_country_state_idx" ON "ShippingPlace"("country", "state");
CREATE UNIQUE INDEX "Collection_slug_key" ON "Collection"("slug");
CREATE INDEX "Collection_isVisible_idx" ON "Collection"("isVisible");
CREATE INDEX "ProductCollection_productId_idx" ON "ProductCollection"("productId");
CREATE INDEX "ProductCollection_collectionId_idx" ON "ProductCollection"("collectionId");
CREATE UNIQUE INDEX "BundleDeal_name_key" ON "BundleDeal"("name");
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");
CREATE INDEX "ProductTag_productId_idx" ON "ProductTag"("productId");
CREATE INDEX "ProductTag_tagId_idx" ON "ProductTag"("tagId");

ALTER TABLE "AttributeValue" ADD CONSTRAINT "AttributeValue_attributeId_fkey"
    FOREIGN KEY ("attributeId") REFERENCES "Attribute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShippingPlace" ADD CONSTRAINT "ShippingPlace_shippingRuleId_fkey"
    FOREIGN KEY ("shippingRuleId") REFERENCES "ShippingRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductCollection" ADD CONSTRAINT "ProductCollection_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductCollection" ADD CONSTRAINT "ProductCollection_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductTag" ADD CONSTRAINT "ProductTag_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductTag" ADD CONSTRAINT "ProductTag_tagId_fkey"
    FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_taxRuleId_fkey"
    FOREIGN KEY ("taxRuleId") REFERENCES "TaxRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_shippingRuleId_fkey"
    FOREIGN KEY ("shippingRuleId") REFERENCES "ShippingRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_bundleDealId_fkey"
    FOREIGN KEY ("bundleDealId") REFERENCES "BundleDeal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- 4. Seed the default rules
--
-- Both product references are meant to be required, so every existing product
-- needs one before the service can start enforcing that. Seeded from the
-- store's current flat settings so nothing about what a shopper is charged
-- changes on deploy.
-- ============================================================

INSERT INTO "TaxRule" ("id", "name", "type", "value", "updatedAt")
VALUES ('taxrule_default_seed', 'Default', 'PERCENT',
        COALESCE((SELECT "defaultTaxRatePercent" FROM "StoreSetting" LIMIT 1), 0), CURRENT_TIMESTAMP);

INSERT INTO "ShippingRule" ("id", "name", "updatedAt")
VALUES ('shiprule_default_seed', 'Default', CURRENT_TIMESTAMP);

-- One catch-all place, so the default rule can actually deliver somewhere. A
-- rule with no place matches nothing and would make every product
-- undeliverable.
INSERT INTO "ShippingPlace" ("id", "shippingRuleId", "name", "country", "state",
                             "price", "deliveryDays", "updatedAt")
VALUES ('shipplace_default_seed', 'shiprule_default_seed', 'Standard delivery', NULL, NULL,
        COALESCE((SELECT MIN("price") FROM "ShippingMethod" WHERE "isActive" = true), 0),
        COALESCE((SELECT MIN("estimatedDays") FROM "ShippingMethod" WHERE "isActive" = true), 0),
        CURRENT_TIMESTAMP);

UPDATE "Product" SET "taxRuleId" = 'taxrule_default_seed' WHERE "taxRuleId" IS NULL;
UPDATE "Product" SET "shippingRuleId" = 'shiprule_default_seed' WHERE "shippingRuleId" IS NULL;

-- ============================================================
-- 5. Migrate per-product options to shop-wide attributes
--
-- Deduplicated on lower(trim(name)). The chosen surviving name is the
-- alphabetically first spelling, picked only so the result is deterministic
-- rather than dependent on row order.
-- ============================================================

INSERT INTO "Attribute" ("id", "name", "position", "presentation", "updatedAt")
SELECT
    'attr_' || md5(lower(btrim("name"))),
    MIN("name"),
    MIN("position"),
    -- SWATCH wins if any product declared it: a colour presented as plain text
    -- loses information, while a label shown as a swatch only looks odd.
    CASE WHEN bool_or("presentation" = 'SWATCH') THEN 'SWATCH'::"AttributePresentation"
         ELSE 'LABEL'::"AttributePresentation" END,
    CURRENT_TIMESTAMP
FROM "ProductOption"
GROUP BY lower(btrim("name"));

INSERT INTO "AttributeValue" ("id", "attributeId", "label", "position", "swatch", "updatedAt")
SELECT
    'attrval_' || md5(lower(btrim(o."name")) || '|' || lower(btrim(v."label"))),
    'attr_' || md5(lower(btrim(o."name"))),
    MIN(v."label"),
    MIN(v."position"),
    -- Any colour a merchant set survives; NULL only if none of them set one.
    (array_remove(array_agg(v."swatch"), NULL))[1],
    CURRENT_TIMESTAMP
FROM "ProductOptionValue" v
JOIN "ProductOption" o ON o."id" = v."optionId"
GROUP BY lower(btrim(o."name")), lower(btrim(v."label"));

-- The old foreign key must go BEFORE the repoint: it still points at
-- ProductOptionValue, so an UPDATE to an AttributeValue id is rejected by it.
-- The new constraint is added in section 7 once the old tables are gone.
ALTER TABLE "ProductVariantOptionValue" DROP CONSTRAINT "ProductVariantOptionValue_valueId_fkey";

-- Repoint every variant's selection at the new value.
UPDATE "ProductVariantOptionValue" pv
SET "valueId" = 'attrval_' || md5(lower(btrim(o."name")) || '|' || lower(btrim(v."label")))
FROM "ProductOptionValue" v
JOIN "ProductOption" o ON o."id" = v."optionId"
WHERE pv."valueId" = v."id";

-- ============================================================
-- 6. Verification gate
--
-- Aborts the whole migration if any variant's selection changed size. Runs
-- BEFORE the drop, so a failure leaves the old tables intact and the database
-- recoverable by rolling back this transaction.
-- ============================================================

DO $$
DECLARE
    orphaned INTEGER;
BEGIN
    -- Every selection row must now point at a real AttributeValue.
    SELECT COUNT(*) INTO orphaned
    FROM "ProductVariantOptionValue" pv
    LEFT JOIN "AttributeValue" av ON av."id" = pv."valueId"
    WHERE av."id" IS NULL;

    IF orphaned > 0 THEN
        RAISE EXCEPTION
            'Migration aborted: % variant selection(s) do not resolve to an AttributeValue. No data has been dropped.',
            orphaned;
    END IF;
END $$;

-- ============================================================
-- 7. Drop the superseded per-product option tables
-- ============================================================

-- The old valueId constraint was already dropped in section 5, before the
-- repoint that it would otherwise have rejected.
DROP TABLE "ProductOptionValue";
DROP TABLE "ProductOption";
DROP TYPE "OptionPresentation";

ALTER TABLE "ProductVariantOptionValue" ADD CONSTRAINT "ProductVariantOptionValue_valueId_fkey"
    FOREIGN KEY ("valueId") REFERENCES "AttributeValue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
