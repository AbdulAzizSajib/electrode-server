## Why

A product carries three money columns — `costPrice`, `compareAtPrice` and `price` — borrowed from Shopify's vocabulary. Merchants filling in the admin product form cannot tell which is which. The worst of the three is `price`: it reads as "the regular price" but it is the amount actually charged, i.e. the offer price, while the crossed-out regular price lives in `compareAtPrice`. A merchant who reads the names literally enters the pair backwards, and the storefront then shows a strike-through *below* the live price instead of above it.

Renaming the columns to the words merchants already use — purchase, selling, offer — removes the guess.

## What Changes

- **BREAKING** Rename the three pricing columns on `Product` and on `ProductVariant`:
  - `costPrice` → `purchasePrice` (supplier cost; admin-only, never public)
  - `compareAtPrice` → `sellingPrice` (the regular price, shown struck through)
  - `price` → `offerPrice` (what the shopper is actually charged)
- **BREAKING** The same rename lands in every public and admin API response and request body that carries a product or variant price, including `GET /products`, `GET /products/:slug`, `GET /products/search`, the campaign-priced list endpoints and the admin product create/update payloads.
- Rename the derived read-model fields that pair with them so the vocabulary stays consistent end to end: the product search projection's `price`, the public sort allowlist entry `price`, and the `minPrice`/`maxPrice` query filters that target the column.
- Update the admin product form, product list, product detail and variant editor to the new field names, with labels that state what each price means.
- Update the storefront (`electrode-nextjs`) product types, cards, detail view, quick view, compare table, deals and sort helpers.
- **Not renamed** — these are different concepts that merely share the word "price", and touching them would widen the blast radius for no gain: `OrderItem.unitPrice`/`totalPrice`, `CartItem` pricing, `Banner.price`/`discountPrice`, delivery-zone `price` in `StoreSetting.checkoutConfig` and landing-page delivery zones, and `CampaignProduct.discountValue`. The campaign-derived `campaignPrice` attached to product responses also keeps its name — it is a computed result, not one of the three authored columns.
- Add validation of the relationship between the three prices, which does not exist today: `sellingPrice` must not be below `offerPrice`, and `purchasePrice` above `offerPrice` (selling at a loss) is rejected. Currently each field is validated only as `nonnegative()`, so a backwards pair or a loss-making price is accepted silently — the same confusion this change is meant to end.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `api/catalog`: the catalog's product representation gains named, merchant-meaningful price fields; a new requirement that the three prices are mutually consistent (selling ≥ offer > purchase); and a new requirement that supplier cost never reaches an unauthenticated caller. That last guarantee is enforced in code today (the public projection and sort allowlist both exclude `costPrice`) but was never written down as a requirement — the rename touches every guard that implements it, so it is stated now rather than left implicit.

## Impact

**Schema and data** — `prisma/schema/product.prisma` and `prisma/schema/ProductVariant.prisma`; one migration renaming six columns. Renames must use `ALTER TABLE ... RENAME COLUMN` (Prisma `@map` or a hand-edited migration) so existing product prices survive; a drop-and-add would silently zero every price in the catalog.

**Server** (`electrode-server`, ~150 matches across 28 files, of which the product-owned ones are): `product.service.ts` (the `PUBLIC_PRODUCT_SCALARS` projection, the admin report projection, campaign pricing, related-products price band, the raw-SQL search query, `minPrice`/`maxPrice` filtering), `product.validation.ts` (field schemas and `PUBLIC_PRODUCT_SORT_FIELDS`), `product.interface.ts`, `product.controller.ts`, plus `report.stock.ts`, `report.columns.ts`, `report.interface.ts`, `landing-page.service.ts`, `banner.service.ts`, `QueryBuilder.ts` and `cart`/`wishlist`/`order` services where they read a product or variant price.

**Admin** (`electrode-admin`, ~128 matches across 20 files): `product-form-page.tsx`, `products-list-page.tsx`, `product-detail-page.tsx`, `variant-editor.tsx`, `variant-combinations.ts` and its test, `lib/api/products.ts`, `lib/api/reports.ts`.

**Storefront** (`electrode-nextjs`, ~139 matches across 39 files): `types/product.ts`, `services/product.ts`, `store/productApi.ts`, `ProductCard.tsx`, `ProductDetail.tsx`, `ProductQuickView.tsx`, `CompareTable.tsx`, `DealOfWeek.tsx`, `lib/product-sort.ts`, `lib/format.ts`, deals and products pages.

**Cross-repo** — This change's planning home is `electrode-server`, but the work spans three sibling projects. The server, admin and storefront must ship together: the moment the API response field names change, any client still reading `price` renders an empty price. Any other consumer of these endpoints (a mobile app, a partner integration) breaks the same way and is out of this change's reach.

**Sort and filter contracts** — `?sortBy=price` and `?minPrice=`/`?maxPrice=` are public query parameters. Renaming the underlying column changes the accepted parameter values, so saved storefront links and any bookmarked filtered listing stop sorting until the client is updated. Whether to keep accepting the old parameter names as aliases is a decision for design.md.

**Security-sensitive** — `costPrice` is deliberately excluded from `PUBLIC_PRODUCT_SCALARS` and from `PUBLIC_PRODUCT_SORT_FIELDS`; both exist to stop an anonymous caller reading the shop's margins, and the projection comment records that it was once leaking. The rename touches every one of those guards, so the exclusion must be re-verified for `purchasePrice` in the public product projection, the variant projection and the sort allowlist.
