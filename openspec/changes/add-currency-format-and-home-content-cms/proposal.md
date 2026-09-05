## Why

Five gaps, all the same shape: something a merchant should own is still a developer's to change.

**Money renders three different ways.** The storefront's `formatPrice` is `` `৳${value.toFixed(2)}` `` — the symbol is a literal, the decimal count is a literal, and there is no thousands separator. The admin's `formatCurrency` is an `Intl.NumberFormat` pinned to `en-US`/`USD`, so a shop selling in taka shows its owner dollars across 91 call sites. Meanwhile `StoreSetting.currencySymbol` exists, is editable, and is read by almost nothing. A merchant in a currency that writes the symbol after the amount, or that has no minor unit at all, cannot express either.

**Store Settings still asks for a shop-wide tax rate.** That field predates Tax Rules. Catalog → Tax Rules now owns tax properly — named rules, percent or flat, assigned per product — but the old rate is still there and still applied: `order.pricing.ts` charges it on every line whose product has no rule. So a merchant who has moved to Tax Rules has a second, half-forgotten rate quietly taxing anything they forgot to tag.

**"Free shipping over" is filed under the wrong heading.** It sits in Settings → Store Settings → General, next to currency, while every other decision about what an order costs and what checkout asks for now lives on UI → Checkout Setting.

**Two homepage sections are still hardcoded.** "Our Latest Blog" and "What Our Clients Say" render from `frontend/src/data/content.ts`. The blog cards link to `/blogs`, which renders the same four fixtures twice to look fuller, and "Read more" goes to that index rather than to a post — because there are no posts. Publishing an article or adding a customer quote is a code change and a redeploy.

## What Changes

### Currency formatting becomes a real setting

- Two new columns on `StoreSetting`: **`currencyPosition`** (`BEFORE` | `AFTER`) and **`currencyDecimals`** (0–4). They join the existing `currency` and `currencySymbol` on Settings → Store Settings → General, which is what that card now holds.
- **One formatting rule, honoured in all three apps.** The storefront, the admin panel and the server each get a `formatMoney` built from the same four values, so a price shown to a shopper, the same price shown to the merchant, and the same price named in a server error all read identically.
- **BREAKING (display only)**: storefront prices gain thousands separators — `৳1200.00` becomes `৳1,200.00`. Today the storefront groups and the admin does not; one of the two had to move, and grouped is what the admin, every locale and every shopper expects. No stored value changes.
- **Decimal places are presentation only, and the admin says so.** Money is stored `Decimal(12,2)` and computed in cents; setting 0 decimals rounds what is *displayed*, not what is charged, and setting 3 or more shows trailing zeros carrying no stored precision. An inline note on the field states this rather than leaving a merchant to infer it from a total that does not add up on screen.

### Tax Rules become the only source of tax

- **BREAKING**: `StoreSetting.defaultTaxRatePercent` is **removed** — the column, the API field, the admin input, and the `fallbackTaxPercent` path through `quoteTax`. A product with no Tax Rule assigned is untaxed, full stop.
- Store Settings keeps a line pointing at Catalog → Tax Rules, the same way it points at UI → Site Setting for branding.
- **This changes order totals** for any shop whose stored rate is non-zero and whose products are not all tagged with a Tax Rule. The migration is preceded by a task to read the current value and, if it is non-zero, create the equivalent Tax Rule and assign it before the column goes.

### "Free shipping over" moves to Checkout Setting

- **BREAKING (admin UI only, no data change)**: the field leaves Settings → Store Settings and appears on UI → Checkout Setting. The column, the endpoint and the waiver logic are untouched; only the editing surface moves, so one field keeps one home.
- **Bug fixed on the way**: `freeShippingThreshold` is `.optional()` on the server, and the current page omits the key when the input is blank — which means "leave unchanged". A merchant who sets a threshold today can never turn it off again. The field becomes `.nullable()` so blanking it genuinely clears it.

### "Our Latest Blog" becomes a blog

- New **`BlogPost`** model and module: title, slug, excerpt, rich-text body, publish date, SEO title/description, status, and **one media slot that is either an uploaded image or an uploaded video** (with its poster frame), through the existing `POST /uploads/image` and `POST /uploads/video`.
- New admin pages under **UI → Blog** — list and form — following the existing UI → Pages editor, which already has the Tiptap body, slug handling and status control this needs.
- The storefront's homepage section, the `/blogs` index and a **new `/blogs/<slug>` detail page** all read from the API. "Read more" finally goes somewhere. A video post shows its poster frame with a play affordance in the grid and plays on the detail page — four autoplaying videos on the homepage is not what "dynamic" should cost.
- The homepage section is omitted entirely when nothing is published, matching how the merchandising rows already handle an unseeded catalog.

### "What Our Clients Say" becomes editable

- New **`Testimonial`** model and module: quote, author name, author role, uploaded author photo, a 1–5 star rating, status and sort order.
- New admin pages under **UI → Testimonials**.
- The star rating stops being hardcoded `5` and becomes the stored one. The card gains the author photo, falling back to the author's initials when none is uploaded, so an entry without a photo is still a finished-looking card rather than a gap.
- Section omitted when nothing is published, as above.
- `blogPosts` and `testimonials` are deleted from `frontend/src/data/content.ts`; **`grep -r "blogPosts\|testimonials" frontend/src/data` must return nothing.**

## Capabilities

### New Capabilities

- `store-config/currency-format`: How money is written throughout the system — the currency code, symbol, whether the symbol leads or trails the amount, and how many decimal places show — and the guarantee that the storefront, the admin panel and the server all render a given amount identically. Includes what decimal places do and deliberately do not affect.
- `store-config/tax-configuration`: That Tax Rules are the sole source of tax on an order, that a product with no rule assigned is untaxed, and that no shop-wide fallback rate exists or can be configured.
- `storefront-cms/blog`: Merchant-authored blog posts — their content, their single image-or-video media slot, their publication lifecycle, and the three storefront surfaces they feed (homepage section, index, detail page).
- `storefront-cms/testimonials`: Merchant-authored customer testimonials — quote, author identity, photo, rating and ordering — and how the storefront section renders them, including when there are none.
- `storefront-cms/checkout-config`: Adds one requirement to the capability path `add-checkout-and-site-settings` introduced — that the free-shipping-by-order-value threshold is configured on the Checkout Setting page, and that clearing it removes the offer. Written as an ADDED delta because `openspec/specs/` at this root is still empty; it merges cleanly whether or not that change is synced first.

### Modified Capabilities

None. `openspec/specs/` at this root is empty — `add-admin-ui-cms-section` and `add-checkout-and-site-settings` both declared `storefront-cms/*` capabilities and neither has been synced or archived, so there is no published requirement here to amend. The server's `api/checkout` spec keeps its requirements unchanged: removing the fallback tax rate narrows *where a rate comes from*, not how an order is priced, quoted or validated.

## Impact

**Server** (`server/`)
- `prisma/schema/StoreSetting.prisma` — add `currencyPosition` (new `CurrencyPosition` enum) and `currencyDecimals`; **drop** `defaultTaxRatePercent`
- `prisma/schema/BlogPost.prisma`, `prisma/schema/Testimonial.prisma` — new models; `enums.prisma` — `CurrencyPosition`, `BlogPostStatus`, `TestimonialStatus`, `BlogMediaType`
- Three migrations: additive (currency), destructive (tax column), additive (two tables)
- `src/app/module/store-setting/` — validation, constants, interface, and the public allow-list projection for the two new currency fields
- `src/app/module/blog-post/`, `src/app/module/testimonial/` — new modules (route, controller, service, validation, interface, constant), registered in `src/app/routes/index.ts`
- `src/app/utils/formatMoney.ts` — new; used where the server emits a formatted amount (`order.service.ts` price-mismatch message, `supplier-payment.service.ts` overpayment message). CSV exports keep emitting bare decimals — a spreadsheet must read those columns as numeric
- `src/app/module/order/order.pricing.ts` — `fallbackTaxPercent` removed from `quoteTax` and `IChargeQuoteInput`; `order.service.ts` — both call sites
- `src/app/utils/revalidateStorefront.ts` — two new tags
- `postman/Ecom.postman_collection.json`

**Admin** (`admin/`)
- `src/lib/utils/format.ts` — `formatCurrency`/`formatCompactCurrency` driven by the stored settings; a provider at the app root supplies them. **All 91 existing call sites keep their signature**
- `src/features/settings/store-settings/store-settings-page.tsx` — currency position and decimals added; tax rate and free-shipping threshold removed
- `src/features/ui/checkout-settings/checkout-settings-page.tsx` — gains the free-shipping threshold
- `src/features/ui/blog/`, `src/features/ui/testimonials/` (new); `src/routes/nav-config.ts`, `src/routes/app-router.tsx`
- `src/lib/api/blog-posts.ts`, `src/lib/api/testimonials.ts` (new); `src/lib/api/store-settings.ts` — currency fields in, tax rate out
- `postman/Ecom.postman_collection.json`

**Frontend** (`frontend/`)
- `src/lib/format.ts` — `formatPrice` driven by the merchant's format; **all 51 existing call sites keep their signature**
- `src/components/providers/CurrencyFormatProvider.tsx` (new), wired in `src/app/layout.tsx`
- `src/services/blog.ts`, `src/services/testimonials.ts`, `src/types/blog.ts`, `src/types/testimonial.ts` (new)
- `src/components/home/BlogSection.tsx`, `src/components/home/Testimonials.tsx` — API-driven; `src/app/page.tsx` — both sections conditional
- `src/app/blogs/page.tsx` — dynamic; `src/app/blogs/[slug]/page.tsx` (new)
- `src/data/content.ts` — `blogPosts` and `testimonials` deleted
- `src/app/api/revalidate/route.ts` — two new allowed tags
- `postman/Ecom.postman_collection.json`

**Cross-cutting**
- All three Postman collections stay byte-identical; `pnpm -C server verify:postman` must pass.
- No new dependency in any of the three apps.
