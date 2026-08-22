## Why

The schema review in `add-schema-erd-diagram` (see its proposal's Why / the "Known gaps" section of `docs/database-erd.html`) found five feature-level gaps that a normal industry-standard storefront needs but this schema doesn't yet have: no persisted `Cart`/`CartItem`, no `Wishlist`, no store-wide `Settings` model, no `Tax`/`Currency` configuration, and `Product` supports only one `Category`. The user asked for these to be built. This change covers four of the five as one bundle (`Cart`, `Wishlist`, store `Settings` incl. tax/currency, and multi-category products) — grouped together because they're all additive, storefront-facing data-model gaps identified in the same review, not because they're technically coupled.

Clarified with the user: **cart must work for both guest (not-logged-in) and logged-in customers**, with the guest cart merging into the customer's cart on login/registration — this is the standard e-commerce pattern and materially shapes the `Cart` model (it needs an identity path that doesn't require a `Customer` row).

## What Changes

- Add `Cart` + `CartItem`: a persisted server-side cart, addressable either by `customerId` (logged-in) or an opaque `guestToken` (not logged-in, stored in a cookie by the API layer — cookie/session mechanics are implementation, not schema). On login/registration, a guest cart's items are merged into the customer's cart.
- Add `Wishlist` + `WishlistItem`: one wishlist per `Customer` (login required — there is no guest wishlist, unlike cart), holding saved products.
- Add `StoreSetting`: a single-row, typed store-configuration record (store name, currency code + symbol, a flat default tax rate percentage, free-shipping threshold, contact info). This is a simple flat-rate tax model, not a per-region/per-category tax-rules engine, and single-currency (not multi-currency) — both are explicit scope decisions, not oversights (see design.md).
- Add `Product` ↔ `Category` many-to-many via a new `ProductCategory` join table, **additive** alongside the existing `Product.categoryId`/`category` relation (kept as the product's primary/canonical category for URLs and breadcrumbs). This is a non-breaking addition, not a replacement of the existing single-category relation.
- Add every required opposite relation field on `Customer`, `Product`, `ProductVariant`, and `Category` for the new models above.

## Capabilities

### New Capabilities
- `commerce/cart`: A persisted shopping cart, usable by guest or logged-in shoppers, that survives across requests/devices for logged-in customers and merges on login.
- `commerce/wishlist`: A per-customer saved-products list.
- `platform/store-settings`: A single, typed source of truth for store-wide configuration (currency, flat tax rate, free-shipping threshold, contact info).
- `catalog/product-categorization`: Lets a product be tagged into more than one category (in addition to its existing single primary category) so it can appear on more than one category listing page.

### Modified Capabilities
<!-- None. `data-model/schema-relations` (relation-integrity contract) is unaffected — every new relation added here ships with its opposite field from the start. -->

## Impact

- **Affected files**: new `prisma/schema/Cart.prisma`, `CartItem.prisma`, `Wishlist.prisma`, `WishlistItem.prisma`, `StoreSetting.prisma`, `ProductCategory.prisma`; edits to `customer.prisma`, `product.prisma`, `productVariant.prisma`, `category.prisma` for new opposite relation fields.
- **Database**: additive migration (new tables + new nullable/optional FK columns only) — no existing column is dropped, retyped, or made required, so no backfill is needed (unlike the `User.role` migration in `fix-prisma-schema-relations`).
- **Application code**: out of scope for this planning change — this change only covers the Prisma schema (models/relations). Building the cart/wishlist/settings API endpoints, guest-cart cookie handling, and the login-time merge logic is follow-up implementation work once these artifacts are approved; `tasks.md` scopes only the schema + the minimum seed/default `StoreSetting` row.
- **Explicitly out of scope**: multi-currency (more than one active currency at once), per-region/per-category tax rules, and replacing the existing single-category `Product.category` relation — all noted in `design.md` as deliberate simplifications, not gaps to revisit silently later.
