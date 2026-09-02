## Context

See proposal.md for motivation. The current product image model is flat: every `ProductImage` belongs to a product, and `ProductVariant.image` stores a single URL string. There is no way to associate multiple images with a specific variant, nor to distinguish product-level cover images from variant-specific gallery images.

The existing Prisma schema already has `ProductImage`, `ProductVariant`, and product create/update flows in `product.service.ts` and `product.controller.ts`. The public product detail projection (`PUBLIC_PRODUCT_DETAIL_SELECT`) returns `images` but not `variantId`.

## Goals / Non-Goals

**Goals:**
- Allow each `ProductImage` to optionally reference a `ProductVariant` via `variantId`
- Support per-variant image galleries (multiple images per variant)
- Preserve product-level images as cover/thumbnail fallback
- Keep public and admin APIs backward compatible for products without variant images
- Ensure variant deletion never destroys linked images

**Non-Goals:**
- Drag-and-drop sort reordering of variant images (out of scope for this change)
- Image deduplication or CDN optimization
- Frontend UI changes (this is a backend API/schema change only)
- Backfill existing variant `image` strings into `ProductImage` rows (migration is additive only)

## Decisions

### Decision 1: Add `variantId` to `ProductImage` as a nullable FK
**Choice**: Add `variantId String?` to `ProductImage.prisma` with `@relation(fields: [variantId], references: [id], onDelete: SetNull)` and `@@index([variantId])`.

**Rationale**: Nullable FK keeps existing product-level images valid without migration. `SetNull` ensures deleting a variant never destroys its images. Index supports queries by variant.

**Alternatives considered**:
- `onDelete: Cascade` — rejected because it would delete photography when a variant is removed.
- Separate `VariantImage` join table — rejected because `ProductImage` already carries `sortOrder`, `url`, etc.; splitting would duplicate that structure.

### Decision 2: Preserve `ProductVariant.image` string field
**Choice**: Keep the existing `ProductVariant.image String?` column. After image sync, set it to the lowest-`sortOrder` linked image's URL (or `null` if none), but only when the variant has at least one linked image. If the variant has no linked images, preserve any directly-supplied `image` value.

**Rationale**: The existing field is used by cart/listing projections. Removing it would be a breaking change. Derived sync keeps it consistent with linked images without forcing a migration.

**Alternatives considered**:
- Drop `ProductVariant.image` and derive it at query time — rejected because it would change every projection that reads it.
- Ignore `ProductVariant.image` and rely solely on `ProductImage.variantId` — rejected for the same backward-compatibility reason.

### Decision 3: Accept both `variantId` and `variantIndex` in inputs
**Choice**: Admin inputs accept `variantId` (direct FK) and `variantIndex` (position in the same request's `variants` array). `variantId` wins when both are present.

**Rationale**: `variantIndex` is convenient during create when variant IDs are not yet known. `variantId` is necessary during update when the client already knows persisted IDs.

**Alternatives considered**:
- Accept only `variantId` — rejected because create flows would need a two-phase submit (create variants first, then images).
- Accept only `variantIndex` — rejected because update flows cannot reference existing variants by position.

### Decision 4: Resolve `variantIndex` after variant creation
**Choice**: In `createProduct`, create the product and variants first inside a `$transaction`, capture generated variant IDs in request order, then create images with `variantIndex` resolved to `variantId`.

**Rationale**: Variants created via nested `create` would share a `now()` timestamp if read back by `createdAt`, making index-based resolution non-deterministic. Creating them one at a time in request order guarantees stable ID ordering.

**Alternatives considered**:
- Read variants back by position after nested create — rejected because timestamp ties break ordering.
- Return generated IDs from a stored procedure — rejected because it adds unnecessary database complexity.

### Decision 5: Validate variant references before any write
**Choice**: Add `ensureVariantReferencesResolve` that checks every image's `variantId`/`variantIndex` against the request's own `variants` array (and, on update, against the product's existing variants). Run it outside the transaction.

**Rationale**: Failing fast before any DB write prevents partial state and keeps error handling simple. On update, checking against *surviving* variants prevents images from pointing at variants the same request is deleting.

**Alternatives considered**:
- Validate inside the transaction — rejected because it would still create the product before failing on a bad image reference.

### Decision 6: Explicitly null out `variantId` on images of deleted variants
**Choice**: Before deleting variants absent from the payload, set their images' `variantId` to `null` in application code, even though `onDelete: SetNull` also enforces it at the DB level.

**Rationale**: Makes the intent explicit and visible in code. Also ensures the images' `url` and `sortOrder` are preserved without relying on DB trigger behavior.

### Decision 7: Sync derived `ProductVariant.image` after image sync
**Choice**: After image sync in both create and update paths, set each variant's `image` to the URL of its lowest-`sortOrder` linked image. Set to `null` when it has none, but only when the variant has at least one linked image — otherwise preserve any directly-supplied `image`.

**Rationale**: Keeps the derived field consistent with the new source of truth without clobbering manually set values on unlinked variants.

### Decision 8: Leave list/search projections unchanged
**Choice**: Do not add `variantId` to `PUBLIC_PRODUCT_LIST_SELECT`, `PRODUCT_LIST_INCLUDE`, or `searchProducts` raw-SQL subquery.

**Rationale**: List/search responses do not include full image rows today. Adding `variantId` there would require expanding those projections, which is a separate concern. Detail views already include full images.

## Risks / Trade-offs

- **Risk**: `variantIndex` resolution becomes ambiguous if variants are created out of order.
  **Mitigation**: Variants are created sequentially in request order inside a single transaction; IDs are captured immediately after each insert.

- **Risk**: Admin clients may send both `variantId` and `variantIndex` inconsistently.
  **Mitigation**: Validation helper normalizes by preferring `variantId` when both are present; `variantIndex` is resolved only when `variantId` is absent.

- **Risk**: Existing `ProductVariant.image` values may become stale if images are managed outside this API.
  **Mitigation**: All image mutations flow through `createProduct`/`updateProduct`, so the derived sync always runs after a legitimate change.

## Migration Plan

1. Deploy schema migration adding `variantId` to `ProductImage` (nullable, additive).
2. Deploy application code with the new validation, create/update, and projection logic.
3. No backfill required — the column is nullable and existing images remain valid with `variantId: null`.

## Open Questions

None. The existing catalog has 2 variants, 0 with `image` set, so no backfill decision is needed.
