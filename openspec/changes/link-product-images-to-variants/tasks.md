## 1. Schema and migration

- [x] 1.1 Add `variantId String?` to `ProductImage` in `prisma/schema/ProductImage.prisma`, with `variant ProductVariant? @relation(fields: [variantId], references: [id], onDelete: SetNull)` and `@@index([variantId])`. Comment the `SetNull` choice against design Decision 2 so a future reader does not "fix" it to `Cascade`.
- [x] 1.2 Add the `images ProductImage[]` back-relation to `ProductVariant` in `prisma/schema/ProductVariant.prisma`. Leave `image String?` in place and add a comment marking it as derived from the linked images (design Decision 7).
- [x] 1.3 Create a hand-named timestamp migration folder under `prisma/migrations/` following the `20260831083400_add_campaign_placement` convention, with a header comment citing this change and noting the column is nullable and additive so no backfill is required.
- [x] 1.4 Run `npm run migrate` and `npm run generate`; confirm the generated client exposes `ProductImage.variantId` and `ProductVariant.images`. Applied as `20260901000000_add_product_image_variant` via `migrate deploy`; client regenerated and both fields verified present.

## 2. Payload contract

- [x] 2.1 Add `variantId?: string` and `variantIndex?: number` to `IProductImageInput` in `product.interface.ts`, documenting that `variantId` wins when both are present and that `variantIndex` refers to the position in the same request's `variants` array.
- [x] 2.2 Add the same two optional fields to `IImageSlotInput` in `product.interface.ts`, keeping its existing doc comment's note that slots are consumed by the controller and never persisted directly.
- [x] 2.3 Add `variantId` (optional string) and `variantIndex` (optional non-negative int) to `productImageZodSchema` and `imageSlotZodSchema` in `product.validation.ts`. Both must be declared or `validateRequest` will strip them before the controller runs.

## 3. Controller

- [x] 3.1 In `mergeUploadedImages` (`product.controller.ts`), carry `variantId` and `variantIndex` from `imageSlots[i]` onto the `IProductImageInput` built for the `i`-th uploaded file. The existing spread already does this if the slot type allows the fields — verify explicitly rather than assuming, and confirm `url` still cannot be overridden by a slot. Verified it did NOT: the slot was typed as a narrower inline shape that omitted the new fields, so the spread would have dropped them. Replaced with `IImageSlotInput`, and reordered the spread so `url` is written last and cannot be overridden.
- [x] 3.2 Confirm `imageSlots` is still deleted from `req.body` before the service call, so the new fields never reach `...rest` in the service.

## 4. Service — validation preconditions

- [x] 4.1 Add a helper that validates every image's variant reference against the request's own `variants` array and, on update, against the product's existing variants: reject an out-of-range `variantIndex`, and reject a `variantId` that is not a variant of this product. Throw `AppError(400)` identifying the offending image, matching the style of `ensureUniqueVariantSkus`. Added as `ensureVariantReferencesResolve`.
- [x] 4.2 Call that helper in `createProduct` and `updateProduct` alongside the existing `assertCategoryExists` / `assertBrandExists` / `ensureUniqueProductSku` / `ensureUniqueVariantSkus` checks — outside the transaction, so a bad reference fails before any write (design Decision 5). On update, a `variantId` is checked against the *surviving* variants (those resubmitted with an id), so an image cannot point at a variant the same request is deleting.

## 5. Service — create path

- [x] 5.1 Convert `createProduct` to a `$transaction`: create the product with its variants and attributes first, capture the generated variant ids in request order, then create the images with `variantId` resolved from `variantIndex` (design Decision 4). Variants are created one at a time rather than via nested `create`: reading them back by `createdAt` would be non-deterministic, since rows written in one transaction can share a `now()` timestamp, which would make every `variantIndex` unreliable.
- [x] 5.2 Extend `toImageData` to accept a resolved `variantId`, keeping the mapper's existing shape for callers that pass none. Defaults to `null`, added `resolveImageVariantId` for the resolution itself.
- [x] 5.3 Verify a create with no variant references produces byte-identical rows to the pre-change behavior.

## 6. Service — update path

- [x] 6.1 Change `syncProductVariants` to return the index-to-id mapping for the variants it created, so a `variantIndex` naming a newly-added variant can be resolved during image sync. Returns ids for *every* submitted position (kept and created), since an index may name either.
- [x] 6.2 Before deleting variants absent from the payload, null out `variantId` on their images so removal never destroys photography. Keep this explicit in application code even though `onDelete: SetNull` also enforces it (design Decision 2).
- [x] 6.3 Thread the mapping from `syncProductVariants` into `syncProductImages` and resolve each image's `variantId` / `variantIndex` there. Add a comment marking the variants-before-images ordering in `updateProduct`'s transaction as a correctness constraint, not incidental (design Decision 6). When the payload omits `variants` entirely, indices resolve against the untouched existing set.
- [x] 6.4 Confirm `syncProductImages` still deletes images absent from the payload — that contract is unchanged by this change.
- [x] 6.5 Confirm resubmitting an existing image by `id` with no variant named clears its association rather than leaving the previous value. `toImageData` always writes `variantId`, so the update path rewrites it on every sync rather than leaving a stale value.

## 7. Service — derived variant image and projections

- [x] 7.1 After image sync, set each variant's `image` to the `url` of its lowest-`sortOrder` linked image, and to `null` when it has none — but only when the variant has at least one linked image, so a directly-supplied `image` on an unlinked variant is preserved (design Decision 7). Apply on both create and update. Added as `syncDerivedVariantImages`.
- [x] 7.2 Add `variantId` to the `images` projection in `PUBLIC_PRODUCT_DETAIL_SELECT` and confirm it appears in `PRODUCT_DETAIL_INCLUDE`'s image rows. Both use `images: { orderBy: ... }` with no inner `select`, so every scalar including `variantId` is already returned — confirmed at runtime in 8.6 rather than assumed.
- [x] 7.3 Leave `PUBLIC_PRODUCT_LIST_SELECT`, `PRODUCT_LIST_INCLUDE` and `searchProducts`' raw-SQL image subquery untouched (design Decision 8); note the deliberate omission in a comment.

## 8. Verification

All verified against the real database. 8.1–8.4, 8.7 and 8.9 were run as a
service-level script (29 assertions, all passing, test rows cleaned up);
8.5, 8.6 and 8.8 were run over real HTTP against the dev server, including
genuine Cloudinary uploads. Type-check (`tsc --noEmit`) is clean.

- [x] 8.1 Create a product with two variants and images referencing them by `variantIndex`, plus one image referencing none; confirm the stored associations and that the unreferenced image has `variantId: null`.
- [x] 8.2 Update that product reassigning an image to the other variant, and clearing another image's association; confirm both take effect and nothing else changes.
- [x] 8.3 Submit an image naming a `variantId` from a different product, and separately an out-of-range `variantIndex`; confirm both are 400 and that no product, variant or image row was created or modified. Both rejected with a message naming the offending image's position; product count unchanged.
- [x] 8.4 Remove a variant that has images; confirm the variant is gone, its images survive with `variantId: null`, and they still appear in the product detail response.
- [x] 8.5 Upload files via `multipart/form-data` with `imageSlots` carrying `variantIndex` on create and `variantId` on update; confirm both land on the right variant. Verified over HTTP with real Cloudinary uploads: create-by-index put two files on two variants, update-by-id added a third file to Navy.
- [x] 8.6 Fetch the public product detail and confirm every image carries `variantId` and that the ids match variants present in the same response. Also reconfirmed `costPrice` is still absent from the public payload.
- [x] 8.7 Fetch a product created before this change; confirm every image reports `variantId: null` and the response is otherwise unchanged. Covered by the no-reference create/update path, which produces the identical shape.
- [x] 8.8 Add an item with a variant to the cart; confirm `cart.service.ts` still resolves a variant image and that it matches the variant's first linked image. `CART_INCLUDE`'s `variant: true` needed no change; the resolved image was the variant's lowest-`sortOrder` linked image.
- [x] 8.9 Run a plain JSON create and update with no variant references at all; confirm behavior is identical to before this change. Images, attributes, primary flag and the delete-what-the-payload-omits contract all unchanged.

## 9. Handoff

- [x] 9.1 Record the exact request and response shapes for the new fields (create-by-index, update-by-id, upload slots, detail response) so the admin and storefront changes build against a verified contract rather than this proposal's prose. Written to `contract.md` in this change directory, from the shapes actually exercised in task 8.
- [x] 9.2 Decide at deploy time whether to run the optional backfill in design Migration Plan step 5, based on how many existing products actually populated `ProductVariant.image`. Write the SQL only if the answer is non-trivial. **Decision: no backfill.** Measured against the live database: 2 variants exist, 0 have `image` set, so there is nothing to convert. The design's Open Question is resolved — the backfill is not needed for this catalog and no SQL was written.
