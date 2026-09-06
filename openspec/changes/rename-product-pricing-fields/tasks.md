## 1. Safety net before touching data

> Two facts found when applying, which change how this section is done:
>
> - **There is no test framework on the server.** `npm test` is the "no test
>   specified" placeholder and no test file exists outside `node_modules`. The
>   project verifies against the real database with `scripts/verify-*.ts`
>   (`__verify_*`-prefixed fixtures, deleted in a `finally`). The tests called
>   for in 1.2, 1.3, 4.4 and 6.1 are therefore written as one such script,
>   `scripts/verify-product-pricing.ts`, rather than as unit tests. Adding
>   vitest was considered and rejected as scope this change does not need.
> - **There is one database and it holds throwaway data.** `DATABASE_URL` points
>   at a Neon instance with `NODE_ENV=development`; there is no separate dev
>   database. The user confirmed the data is fake and that losing it is
>   acceptable, so the backup step below is not required and the migration is
>   verified directly on this database. The migration is still written as
>   `RENAME COLUMN` — it has to run on real data in production later.

- [x] 1.1 ~~Take a database backup~~ — not required: the user confirmed this database holds fake data that is safe to lose. The `RENAME COLUMN` form in section 2 still stands, for the production run
- [x] 1.2 Assert an unauthenticated `GET /products/:slug` response contains no `costPrice`, at the product level and inside `variants[]`, and confirm it passes against current code (design.md Decision 6 — asserting after the rename risks passing because the field name no longer exists anywhere). Written into `scripts/verify-product-pricing.ts`, not a unit test
- [x] 1.3 Assert `?sortBy=costPrice` on a public listing is refused; confirm it passes against current code. Same script
- [x] 1.4 Record the three price values of two or three known products, one with a variant, to spot-check after the migration

## 2. Schema and migration

- [x] 2.1 Rename the three fields in `prisma/schema/product.prisma`: `costPrice` → `purchasePrice`, `compareAtPrice` → `sellingPrice`, `price` → `offerPrice`, keeping current nullability exactly (`offerPrice` required, other two optional) and the `@db.Decimal(12, 2)` annotations
- [x] 2.2 Rename the same three fields in `prisma/schema/ProductVariant.prisma`, all three staying optional
- [x] 2.3 Generate the migration with `prisma migrate dev --create-only` — do NOT let it apply. It refused to write a file (non-interactive environment) but printed its intent first, confirming Decision 2 exactly: it planned to DROP `compareAtPrice` and `price` ("still contains 2 non-null values") and ADD a required `offerPrice`. That output was discarded
- [x] 2.4 Hand-write the migration as six `ALTER TABLE ... RENAME COLUMN` statements with a header comment quoting the destructive output it replaces — `migrations/20260906130000_rename_product_pricing_fields/migration.sql`
- [x] 2.5 Read the final SQL line by line and confirm no statement can drop or null a price column — audited: 6 statements, all `RENAME COLUMN`, no `DROP`/`ADD COLUMN`/`SET NOT NULL`/`UPDATE`/`DELETE`
- [x] 2.6 Apply and verify the products recorded in 1.4 still hold their values — applied with `prisma migrate deploy`; prices identical across the rename (750/1200, 469/919, variants 750), old column names gone, nullability unchanged (`Product.offerPrice` NOT NULL, the rest nullable)
- [x] 2.7 Regenerate the Prisma client

## 3. Server — product module

- [x] 3.1 `product.interface.ts`: rename the three fields on `ICreateProductPayload` and `IProductVariantInput`; rename `ISearchedProduct.price` → `offerPrice`
- [x] 3.2 `product.validation.ts`: rename the three fields in the product and variant schemas
- [x] 3.3 `product.validation.ts`: replace `price` with `offerPrice` in `PUBLIC_PRODUCT_SORT_FIELDS`, keeping `purchasePrice` absent from it (design.md Decision 4)
- [x] 3.4 `product.service.ts`: rename the three fields in the admin report projection and in `PUBLIC_PRODUCT_SCALARS`, keeping `purchasePrice` excluded from the public one
- [x] 3.5 `product.service.ts`: rename in the variant projection inside the public product `select` — a separate `select` from 3.4 and easy to miss
- [x] 3.6 `product.service.ts`: update the raw SQL search query and its row-mapping to `ISearchedProduct`. The new name needs quoting — unlike all-lowercase `price`, an unquoted `offerPrice` folds to `offerprice` and fails to resolve
- [x] 3.7 `product.service.ts`: update the raw SQL related-products query, both the `p."price"` in the score expression and the `select` that reads `source.price` for the price band — also invisible to the type checker
- [x] 3.8 `product.service.ts`: update `minPrice`/`maxPrice` filtering to build `where.offerPrice`, keeping the query parameter names as they are (design.md Decision 4)
- [x] 3.9 `product.service.ts`: update campaign pricing to read `product.offerPrice` as its base, leaving the derived `campaignPrice` field name unchanged
- [x] 3.10 `product.service.ts`: update the variant create/update mapping that copies the three price fields
- [x] 3.11 `product.controller.ts`: rename where it touches the price fields

## 4. Server — consistency validation

- [x] 4.1 Add cross-field validation to `product.validation.ts`: reject `sellingPrice < offerPrice` and `offerPrice <= purchasePrice` when the compared field is present, with an error naming both offending fields. `createProductZodSchema` is now the base object plus a `superRefine`; `updateProductZodSchema` is the base made partial and then refined, because `.partial()` is unavailable once a schema carries a refinement
- [x] 4.2 Apply the same validation to variant entries, comparing a variant's prices against its own values
- [x] 4.3 Make partial update validate against stored values — `ensurePricesStayConsistent` in `product.service.ts` merges the payload over the row `updateProduct` already loads, and throws before anything is written (design.md Decision 5)
- [x] 4.4 Cover the spec scenarios in `scripts/verify-product-pricing.ts`: backwards pair rejected, below-cost rejected, equal selling/offer accepted, variant judged on its own prices, the error naming both fields, a partial update rejected against the STORED `sellingPrice`, and a consistent partial update still succeeding

## 5. Server — other modules reading a product price

- [x] 5.1 `banner.service.ts` + `banner.interface.ts`: rename in the product `select`, in `IBannerProductSummary` and in the summary mapping; `resolvedPrice`/`resolvedDiscountPrice` and the banner's own `price`/`discountPrice` columns keep their names (out of scope per proposal)
- [x] 5.2 `landing-page.service.ts` + `landing-page.interface.ts`: rename in both product `select`s and where the quote reads the unit price. `unitPrice` keeps its name; the snapshot's `compareAtPrice` field became `sellingPrice`, since it was only ever an echo of the product's column
- [x] 5.3 `report.stock.ts`, `report.columns.ts`, `report.interface.ts`: rename throughout — all raw SQL, so the type checker flagged none of it. The CSV headers were mislabelled in exactly the way this change is about ("Selling price" over the offer-price column) and now read "Purchase price" / "Offer price"
- [x] 5.4 `cart.service.ts`, `order.service.ts`, `coupon.service.ts` + `coupon.interface.ts`: rename where they read a product or variant price. `ICartItemForDiscount` carried `product: { price }`, so it moved too. `OrderItem.unitPrice`/`totalPrice` untouched
- [x] 5.5 `QueryBuilder.ts`: comment only — it names no price column in code
- [x] 5.6 Confirm `order.pricing.ts` needs no change — every `price` in it is a delivery option's, not a product's (proposal: not renamed). Verified by reading all 10 occurrences
- [x] 5.7 Run `tsc --noEmit` on the server and resolve every error — clean, apart from a pre-existing unrelated error in `lib/auth.ts` (a Better Auth `type` union mismatch) that this change did not introduce and does not touch

## 6. Server — verification

- [x] 6.1 Re-run the section 1 checks after the rename — the script detects the live field names from the Prisma model, so the same assertions ran against `purchasePrice`. 20/20 passed, proving the guard survived rather than passing because the old name vanished
- [x] 6.2 Exercise `GET /products/search` — returned 1 row keyed `offerPrice` against a fixture, so the raw SQL from 3.6 genuinely executed
- [x] 6.3 Exercise the related-products endpoint — ran without error and returned an array; covers the raw SQL from 3.7
- [x] 6.4 Exercise `?sortBy=offerPrice`, `?sortBy=purchasePrice` (refused), and `maxPrice` — all as specified
- [x] 6.5 Update the Postman collection: 8 product/variant request bodies plus the `sortBy` negative test and three prose descriptions. Banner, delivery-zone and store-setting price fields deliberately untouched; JSON re-validated

## 7. Admin

- [x] 7.1 `lib/api/products.ts`: rename the three fields across `ProductVariant`, `ProductVariantInput`, `Product`, `ProductInput` and `ProductListRow`. Also ADDED `purchasePrice` to `ProductInput` — it was absent, so the form could never send a supplier cost even though the list column displayed one
- [x] 7.2 `lib/api/reports.ts`: rename in `StockReportRow`, and align the stock report page's "no cost price" wording with the new vocabulary
- [x] 7.3 `product-form-page.tsx`: three labelled fields — "Purchase price" (extra: "What you paid your supplier. Never shown to customers."), "Offer price" ("What the customer actually pays."), "Regular price" ("Shown struck through above the offer price."). The old labels were "Price" and "Compare-at price", which is the confusion this change exists to fix
- [x] 7.4 `product-form-page.tsx`: the regular-price help text says to leave it empty when the product is not on offer (design.md Decision 3)
- [x] 7.5 `product-form-page.tsx`: the server's consistency errors surface as-is — they already name both offending fields (verified in 4.4), and antd renders a rejected submit's message against the form
- [x] 7.6 `variant-editor.tsx` and `variant-combinations.ts`: rename the three fields; table headers now read "Offer price" / "Regular price" instead of "Price" / "Compare-at"
- [x] 7.7 `variant-combinations.test.ts`: fixtures and assertions updated — 29 tests pass
- [x] 7.8 `products-list-page.tsx` and `product-detail-page.tsx`: renamed. The list's `prices()` helper used to translate `compareAtPrice`/`price` into the "Selling"/"Offered" column headings by hand; that translation is gone because the fields now say what the columns say. Detail page gained a "Purchase price" row, shown only when the admin response carries one
- [x] 7.9 Run `tsc -b` on the admin app (project references — plain `tsc --noEmit` compiles nothing here) and resolve every error — clean

## 8. Storefront

- [x] 8.1 `types/product.ts`: rename the three fields across `ApiProductVariant`, `ApiProduct`, `ProductVariant`, `Product`, `ApiSearchSuggestion`, `SearchSuggestion` and `ProductSortField`; `ProductQuery.minPrice`/`maxPrice` left alone
- [x] 8.2 `services/product.ts` and `store/productApi.ts`: rename where prices are read or forwarded. The campaign-vs-base precedence in `toProduct` is untouched — a campaign price still wins and pushes the base price into the struck-through slot
- [x] 8.3 `lib/product-sort.ts`: both price sort options now send `sortBy: "offerPrice"`; `resolveSort()` already falls back for a stale `?sort=` (design.md Decision 4)
- [x] 8.4 `ProductCard.tsx`, `ProductDetail.tsx`, `ProductQuickView.tsx`: renamed. The struck-through figure is still the larger one — `discountPercent` returns null unless `sellingPrice > offerPrice`, and the card only renders the strike-through when `sellingPrice` is set
- [x] 8.5 `CompareTable.tsx`, `DealOfWeek.tsx`, deals and home pages: renamed. The deals page filters on `sellingPrice`, which the service only sets when it is a genuine saving
- [x] 8.6 `lib/format.ts` (`discountPercent` parameters), `lib/landing-page-content.ts`, `types/landing-page.ts`, `LandingPageView.tsx`, `SearchBox.tsx`, `types/wishlist.ts`, `product-options.test.ts`: renamed. The landing-page snapshot's field had to follow the server's, which changed in 5.2
- [x] 8.7 Confirm cart, checkout, order and landing-page delivery pricing were not touched — verified: every surviving `price` in `types/cart.ts`, `types/order.ts` and `CheckoutForm.tsx` is a delivery-option or order-line price
- [x] 8.8 Run `tsc --noEmit` on the storefront and resolve every error — clean; 116 tests pass

## 9. Ship

- [x] 9.1 Grep all three repos for `compareAtPrice` and `costPrice` — zero in hand-written code. Three deliberate survivors: the two migration files (`init` created the columns under the old names; the rename migration must name them to rename them) and one explanatory comment in `products-list-page.tsx` recording what the list used to translate
- [x] 9.2 Grep for `\bprice\b` across the three product modules — every survivor is out of scope: delivery-option pricing in `order.pricing.ts` and `CheckoutForm.tsx`, order-line `unitPrice`/`totalPrice`, cart line pricing, the banner's own `price`/`discountPrice`, and `campaignPrice`
- [x] 9.3 Verified in `scripts/verify-product-pricing.ts` rather than by hand through three running apps: a product is created with all three prices, its public payload carries the offer and regular price but no supplier cost, and a checkout line prices at 2 × offerPrice (1800) rather than 2 × sellingPrice (2400), with a variant's own offer price overriding its product's. `quoteCheckout` could not be driven end to end — it demands a delivery option and this database has none configured, which is a store-settings gap unrelated to pricing — so the assertion goes at the line total, the same expression `quoteCheckout` builds `pricingLines` from and `placeOrder` captures into `OrderItem.unitPrice`. The strike-through *rendering* is asserted by construction rather than visually: `discountPercent` returns null unless `sellingPrice > offerPrice`, and 116 storefront tests pass
- [ ] 9.4 Apply the migration to production and deploy server, admin and storefront together (design.md Migration Plan) — **left for you**: this touches production data and is a deploy decision, not a code change
