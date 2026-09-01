-- Associates a product image with the variant it depicts, so a storefront can
-- show the photos matching the option a shopper selected instead of one flat
-- gallery unrelated to the variant buttons beside it.
-- See openspec/changes/link-product-images-to-variants design.md Decision 1.
--
-- Additive: a NULLABLE column, so every existing image stays valid and is read
-- as shared across all variants. No backfill is needed and no product changes
-- appearance on deploy.
--
-- ON DELETE SET NULL, deliberately NOT Cascade, and deliberately the opposite
-- of ProductImage.productId: deleting a variant is a routine catalog edit and
-- must not destroy that variant's photography — its images fall back to shared.
-- See design.md Decision 2.

-- AlterTable
ALTER TABLE "ProductImage" ADD COLUMN     "variantId" TEXT;

-- CreateIndex
CREATE INDEX "ProductImage_variantId_idx" ON "ProductImage"("variantId");

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
