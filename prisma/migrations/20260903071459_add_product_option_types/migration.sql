-- Gives a product named axes of choice (Colour, Size, Weight) with ordered
-- values, and defines a variant by the values it selects rather than by a
-- free-text name. This is what lets a two-option product resolve "Black" +
-- "256GB" to one purchasable row, and lets sizes render S -> M -> XL instead of
-- alphabetically.
-- See openspec/changes/add-product-option-types design.md.
--
-- Purely additive. No existing column is altered and no data is rewritten:
-- ProductVariant.name and .attributes are untouched, and every product already
-- in the catalog simply has no options. Those keep rendering as a single choice
-- built from variant names, so nothing changes appearance on deploy and no
-- backfill is required. Migrating a real product to real options is a merchant
-- action in the admin, product by product.
--
-- The unique constraints are what keep a selection unambiguous: one option per
-- name per product, one value per label per option. A variant selecting "one
-- value per option" would be meaningless without them.
--
-- Cascade throughout: an option value is meaningless without its option, and a
-- join row without either end. Refusing to delete an option or value that
-- variants still reference is enforced in the admin, not here — a database
-- restriction would block legitimate product deletion too.

-- CreateEnum
CREATE TYPE "OptionPresentation" AS ENUM ('SWATCH', 'LABEL');

-- NOTE: `prisma migrate dev` generated three DROP INDEX statements here for
-- Product_name_trgm_idx, Product_sku_trgm_idx and Brand_name_trgm_idx. They have
-- been removed deliberately. Those are pg_trgm GIN indexes created by raw SQL in
-- 20260831000000_add_product_search_indexes and not modelled in schema.prisma,
-- so Prisma reads them as drift on every subsequent migration. Dropping them
-- would silently degrade ProductService.searchProducts to a sequential scan.
-- Re-removing them is required on any future generated migration too.

-- CreateTable
CREATE TABLE "ProductOption" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "presentation" "OptionPresentation" NOT NULL DEFAULT 'LABEL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductOptionValue" (
    "id" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "swatch" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductOptionValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariantOptionValue" (
    "variantId" TEXT NOT NULL,
    "valueId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductVariantOptionValue_pkey" PRIMARY KEY ("variantId","valueId")
);

-- CreateIndex
CREATE INDEX "ProductOption_productId_idx" ON "ProductOption"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductOption_productId_name_key" ON "ProductOption"("productId", "name");

-- CreateIndex
CREATE INDEX "ProductOptionValue_optionId_idx" ON "ProductOptionValue"("optionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductOptionValue_optionId_label_key" ON "ProductOptionValue"("optionId", "label");

-- CreateIndex
CREATE INDEX "ProductVariantOptionValue_variantId_idx" ON "ProductVariantOptionValue"("variantId");

-- CreateIndex
CREATE INDEX "ProductVariantOptionValue_valueId_idx" ON "ProductVariantOptionValue"("valueId");

-- AddForeignKey
ALTER TABLE "ProductOption" ADD CONSTRAINT "ProductOption_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOptionValue" ADD CONSTRAINT "ProductOptionValue_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "ProductOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariantOptionValue" ADD CONSTRAINT "ProductVariantOptionValue_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariantOptionValue" ADD CONSTRAINT "ProductVariantOptionValue_valueId_fkey" FOREIGN KEY ("valueId") REFERENCES "ProductOptionValue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
