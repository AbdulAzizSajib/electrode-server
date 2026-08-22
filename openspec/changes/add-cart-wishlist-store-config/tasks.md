## 1. Cart & CartItem

- [x] 1.1 Create `prisma/schema/Cart.prisma`: `Cart` model with `customerId String? @unique`, `guestToken String? @unique`, timestamps, `@@index([customerId])`, `@@index([guestToken])`, and a schema comment documenting the "exactly one of customerId/guestToken" invariant is application-enforced, not DB-enforced (per design.md).
- [x] 1.2 Create `prisma/schema/CartItem.prisma`: `CartItem` model with `cartId`, `productId`, optional `variantId`, `quantity Int @default(1)`, timestamps, `@@unique([cartId, productId, variantId])`, indexes on `cartId`/`productId`.
- [x] 1.3 Add `Cart` relation fields: `Customer.cart Cart?`, `Product.cartItems CartItem[]`, `ProductVariant.cartItems CartItem[]`.

## 2. Wishlist & WishlistItem

- [x] 2.1 Create `prisma/schema/Wishlist.prisma`: `Wishlist` model with `customerId String @unique`, timestamps.
- [x] 2.2 Create `prisma/schema/WishlistItem.prisma`: `WishlistItem` model with `wishlistId`, `productId`, timestamps, `@@unique([wishlistId, productId])`.
- [x] 2.3 Add relation fields: `Customer.wishlist Wishlist?`, `Product.wishlistItems WishlistItem[]`.

## 3. Store Settings

- [x] 3.1 Create `prisma/schema/StoreSetting.prisma`: singleton `StoreSetting` model (`id @default("singleton")`, `storeName`, `currency`, `currencySymbol`, `defaultTaxRatePercent`, `freeShippingThreshold`, contact fields), with a schema comment stating the singleton invariant and the flat single-currency/single-tax-rate scope decision.
- [x] 3.2 Add a seed step: `seedStoreSettings()` added to `src/app/utils/seed.ts`, `upsert`s the `"singleton"` row (idempotent — no-op if it already exists), called from `seedSuperAdmin()` (the existing bootstrap entrypoint already invoked from `src/app/server.ts`, so no other file needed touching).

## 4. Product multi-categorization

- [x] 4.1 Create `prisma/schema/ProductCategory.prisma`: join model (`productId`, `categoryId`, `@@unique([productId, categoryId])`, indexes, `onDelete: Cascade` both sides).
- [x] 4.2 Add relation fields: `Product.categories ProductCategory[]`, `Category.productCategories ProductCategory[]`.
- [x] 4.3 Added clarifying schema comments: on `Product.categoryId`/`category` (stays primary/canonical) and on `Product.categories` (supplementary, additive, doesn't replace the primary relation).

## 5. Validate

- [x] 5.1 `npx prisma format` + `npx prisma validate` — zero errors. Model count is now 46 (was 40 before this change: +`Cart`, `CartItem`, `Wishlist`, `WishlistItem`, `StoreSetting`, `ProductCategory`).
- [x] 5.2 `npx prisma generate` — completed cleanly, regenerated client at `src/generated/prisma`.
- [x] 5.3 `npx tsc --noEmit` — 0 errors (confirms the `seed.ts` change compiles). Also ran `npx eslint src/app/utils/seed.ts` — 0 errors/warnings (not required by this task, but done as a matching check to the pattern used in `fix-prisma-schema-relations`).
- [x] 5.4 Verified each spec's scenarios against the schema shapes. **One real gap found and documented rather than glossed over**: `CartItem`'s `@@unique([cartId, productId, variantId])` does not fully guarantee "at most one line item per product/variant combination" (`specs/commerce/cart/spec.md`) for simple/non-variant products — PostgreSQL treats `NULL` as distinct from `NULL` in unique constraints, so two `CartItem` rows with the same `cartId`+`productId` and both `variantId = null` would NOT violate the constraint. Documented with a schema comment on the constraint (mirroring how the `Cart` identity invariant is already flagged as application-enforced, not DB-enforced) — the future cart-service implementation must use find-or-increment logic rather than a blind insert. All other spec scenarios (`commerce/wishlist`, `platform/store-settings`, `catalog/product-categorization`) are fully representable by the schema as built: `Wishlist.customerId`/`WishlistItem` uniqueness, the `StoreSetting` singleton pattern (fixed id, seeded default), and `ProductCategory`'s additive many-to-many (verified `Product.categoryId`/`category` is untouched) all hold without caveats.
