## 1. Tax migration safety (do this first)

- [x] 1.1 Read the live `StoreSetting.defaultTaxRatePercent` and record the value in the change notes; everything in section 4 depends on knowing it
- [x] 1.2 If it is non-zero: create a Tax Rule of that percentage in Catalog → Tax Rules, assign it to every product with no rule of its own, and confirm a test order's tax is unchanged before proceeding
- [x] 1.3 If it is zero: note that no products change tax treatment, and continue

> **Reading taken before implementation began.** `StoreSetting.defaultTaxRatePercent` is
> **`0.00`** on the singleton row, and every product in the catalogue (2 of 2) already has a
> Tax Rule assigned, so no line was relying on the fallback. Task 1.2 therefore did not
> apply — no Tax Rule needed creating and no product needed tagging. Removing the column in
> section 4 changes no order total. `freeShippingThreshold` was also read as `null`, which is
> the "no offer" state section 5 has to keep distinguishable from `0`.

## 2. Server — currency format columns

- [x] 2.1 Add `enum CurrencyPosition { BEFORE AFTER }` to `server/prisma/schema/enums.prisma`
- [x] 2.2 Add `currencyPosition CurrencyPosition @default(BEFORE)` and `currencyDecimals Int @default(2)` to `StoreSetting.prisma`, with a doc comment stating that decimals govern presentation only and never what is stored or charged
- [x] 2.3 Create and run **Migration A** — additive only, defaults reproducing today's rendering, so deploying it alone changes nothing
- [x] 2.4 Extend `updateStoreSettingZodSchema` with `currencyPosition` (enum) and `currencyDecimals` (integer 0–4, message naming the range), both `.optional()`
- [x] 2.5 Add both to `DEFAULT_PUBLIC_SETTINGS` in `store-setting.constant.ts` and to `store-setting.interface.ts`
- [x] 2.6 Opt both into the `getPublicStoreSetting` **allow-list**, one explicit merged entry each — the storefront cannot render a price without them

## 3. Server — money formatting

- [x] 3.1 Add `src/app/utils/formatMoney.ts` exporting `formatMoney(amount, { symbol, position, decimals })`, memoising one `Intl.NumberFormat('en-US', …)` per distinct decimal count
- [x] 3.2 Implement the spacing rule: `{symbol}{amount}` for BEFORE, `{amount} {symbol}` (non-breaking space) for AFTER
- [x] 3.3 Use it for the price-mismatch message in `order.service.ts:719` and the overpayment message in `supplier-payment.service.ts:128`, reading the format from the `storeSetting` those paths already load
- [x] 3.4 Leave `report.columns.ts` and `report.csv.ts` emitting bare decimals; add a line to the columns doc-comment recording that this is deliberate so a spreadsheet reads the columns as numeric
- [x] 3.5 Verify: a price-mismatch error on a store configured `$`/AFTER/0 decimals names the amount as `1,200 $`

## 4. Server — remove the shop-wide tax rate

- [x] 4.1 Drop the third parameter from `quoteTax` in `order.pricing.ts`; a line with no `taxRuleId` now contributes zero tax
- [x] 4.2 Remove `fallbackTaxPercent` from `IChargeQuoteInput` and its use in `quoteCharges`, letting the compiler find both `order.service.ts` call sites (lines 705 and 937)
- [x] 4.3 Remove `defaultTaxRatePercent` from `store-setting.validation.ts`, `store-setting.interface.ts`, and any constant referencing it
- [x] 4.4 Remove the column from `StoreSetting.prisma` and update the model doc-comment, which currently advertises a "single-tax-rate model"
- [x] 4.5 Create and run **Migration B** as its own migration, separate from A and C, so a rollback of the destructive step does not take the currency columns with it
- [x] 4.6 Verify: an order of one product with a 15% Tax Rule and one product with no rule charges tax on the first line only, and the order total equals subtotal + shipping − discount + that one line's tax

## 5. Server — free-shipping threshold becomes clearable

- [x] 5.1 Change `freeShippingThreshold` in `updateStoreSettingZodSchema` to `.nullable().optional()`, keeping the non-negative bound for non-null values
- [x] 5.2 Confirm the settings service writes `null` through to the column when it receives `null`, and still leaves the column untouched when the key is absent — the partial-upsert property every settings editor depends on
- [x] 5.3 Verify all three states are distinguishable end to end: threshold set to 5000, threshold set to 0 (every order free), threshold cleared to null (no offer)

## 6. Server — BlogPost module

- [x] 6.1 Add `enum BlogPostStatus { DRAFT PUBLISHED }` and `enum BlogMediaType { NONE IMAGE VIDEO }` to `enums.prisma`
- [x] 6.2 Create `prisma/schema/BlogPost.prisma` with the fields from design.md §7, `slug @unique`, an index on `status`, and a doc-comment recording that `body` is stored as authored and sanitised at render — the same posture as `Page.body`
- [x] 6.3 Create `src/app/module/blog-post/` (route, controller, service, validation, interface) following `src/app/module/page/` file for file
- [x] 6.4 Validate the slug as `^[a-z0-9]+(?:-[a-z0-9]+)*$` and return a message naming the conflicting post on a duplicate, rather than surfacing a raw unique-constraint error
- [x] 6.5 Add the `superRefine` tying media columns to `mediaType`: IMAGE requires `imageUrl` and forbids the video columns, VIDEO requires `videoUrl` and forbids `imageUrl`, NONE forbids all three
- [x] 6.6 Implement the public reads as PUBLISHED-only (`GET /blog-posts` paginated newest-first by `publishedAt`, `GET /blog-posts/:slug`) and the admin reads as any-status
- [x] 6.7 Declare the `/admin` literal routes **above** `/:slug` and carry over `page.route.ts`'s comment explaining why — otherwise `/blog-posts/admin` resolves as a slug lookup and 404s
- [x] 6.8 Register `BlogPostRoutes` at `/blog-posts` in `src/app/routes/index.ts`
- [x] 6.9 Fire `revalidateStorefront("blog-posts")` after every create, update and delete, following the settings service's fire-and-forget usage
- [x] 6.10 Verify: a draft post is absent from both public endpoints and present in the admin list; publishing it makes it appear in both

## 7. Server — Testimonial module

- [x] 7.1 Add `enum TestimonialStatus { DRAFT PUBLISHED }` and create `prisma/schema/Testimonial.prisma` per design.md §7
- [x] 7.2 Create `src/app/module/testimonial/` mirroring the blog module's structure
- [x] 7.3 Validate `rating` as an integer 1–5 with a message naming the range, and reject 0, 6 and fractional values
- [x] 7.4 Order public reads `sortOrder asc, createdAt desc`, matching the Banner convention
- [x] 7.5 Register `TestimonialRoutes` at `/testimonials` and fire `revalidateStorefront("testimonials")` on every mutation
- [x] 7.6 Create and run **Migration C** covering both new tables and all three new enums

## 8. Admin — currency format

- [x] 8.1 Rework `src/lib/utils/format.ts`: a module-scoped format holder with `setCurrencyFormat`, a documented default of `৳`/BEFORE/2, and memoised `Intl.NumberFormat` instances per decimal count
- [x] 8.2 Rewrite `formatCurrency` and `formatCompactCurrency` to read the holder and apply the same spacing rule as the server; **do not change either signature** — all 91 call sites must keep compiling untouched
- [x] 8.3 Keep `formatCompactCurrency` at 1 maximum fraction digit regardless of the configured decimals, and comment why: it is an at-a-glance figure, not an exact one
- [x] 8.4 Add a provider at the app root that calls `setCurrencyFormat` once `useStoreSettings()` resolves, and confirm dashboard figures re-render with the merchant's symbol rather than `$`
- [x] 8.5 Add `currencyPosition` and `currencyDecimals` to the types in `src/lib/api/store-settings.ts`; remove `defaultTaxRatePercent` from both the read type and `StoreSettingsInput`

## 9. Admin — Store Settings page

- [x] 9.1 Add Position (before/after) and Decimal places (0–4) to the General card, beside Currency and Symbol
- [x] 9.2 Show a live preview of a sample amount beside the four fields, so the merchant sees the result rather than composing it in their head
- [x] 9.3 Add the inline note that decimal places affect display only and never what is stored or charged
- [x] 9.4 Remove the Tax rate field and its schema entry; add a Tax card pointing at Catalog → Tax Rules, matching how the Branding card points at UI → Site Setting
- [x] 9.5 Remove the Free shipping over field and its schema entry; add a line pointing at UI → Checkout Setting
- [x] 9.6 Confirm `toInput` no longer sends `defaultTaxRatePercent` or `freeShippingThreshold` — the disjoint-field-set property is what keeps this page from clobbering the checkout editor

## 10. Admin — Checkout Setting page

- [x] 10.1 Add a Free shipping section with the threshold field and its "leave blank to not offer free shipping by order value" description
- [x] 10.2 Send `freeShippingThreshold` alongside `checkoutConfig` in the page's save, sending `null` when the field is blank so clearing it genuinely withdraws the offer
- [x] 10.3 Fold the threshold into the page's existing `useSettingsDraft` dirty tracking so the unsaved-changes guard covers it
- [x] 10.4 Render the threshold's helper text through the shared `formatCurrency` so it shows the merchant's own currency
- [x] 10.5 Verify saving this page leaves every field on Store Settings and Site Setting untouched, and vice versa

## 11. Admin — Blog section

- [x] 11.1 Add `src/lib/api/blog-posts.ts` with the types and react-query hooks, mirroring `pages.ts`
- [x] 11.2 Add **Blog** under the UI section in `src/routes/nav-config.ts` and routes `/ui/blog` and `/ui/blog/:id` in `app-router.tsx`, matching the section's existing `OWNER`/`ADMIN` restriction
- [x] 11.3 Build the list page from `pages-list-page.tsx`: title, slug, status, publish date, media type, with create/edit/delete
- [x] 11.4 Build the form page from `page-form-page.tsx`: title, slug (auto-derived from title, editable), excerpt, Tiptap body, publish date, SEO title/description, status
- [x] 11.5 Add the media control — a single chooser offering Image or Video, using `useUploadImage` and `useUploadVideo`, where picking one clears the other so the form cannot express "both"
- [x] 11.6 Show the currently attached media with a remove action that returns the post to no media
- [x] 11.7 Surface the server's duplicate-slug message on the slug field rather than as a bare toast
- [x] 11.8 Reuse the section's unsaved-changes guard so navigating away mid-edit prompts

## 12. Admin — Testimonials section

- [x] 12.1 Add `src/lib/api/testimonials.ts` with types and hooks
- [x] 12.2 Add **Testimonials** under UI and routes `/ui/testimonials` and `/ui/testimonials/:id`
- [x] 12.3 Build the list page showing author, role, rating, status and order, with create/edit/delete
- [x] 12.4 Build the form: quote, author name, author role, photo upload via `useUploadImage`, a 1–5 star rating control, status, sort order
- [x] 12.5 Mark in the list which entries fall beyond the four the homepage section shows, so a merchant can see why a published entry is not on the site — the same overflow problem `hero-slots.ts` already solves for banners
- [x] 12.6 Show the initials fallback in the form's preview when no photo is uploaded, so the merchant sees what the card will actually look like

## 13. Frontend — currency format

- [x] 13.1 Rework `src/lib/format.ts`: module-scoped format holder, `setCurrencyFormat`, memoised `Intl.NumberFormat` per decimal count, and the documented `৳`/BEFORE/2 fallback that reproduces today's output when the holder is unset
- [x] 13.2 Rewrite `formatPrice` to read the holder and apply the shared spacing rule; **keep its signature** — all 51 call sites must compile untouched
- [x] 13.3 Write the doc comment recording that module scope is sound only because `StoreSetting` is a singleton, and that a future multi-tenant change must revisit it
- [x] 13.4 Add `currencyPosition` and `currencyDecimals` to `src/types/store-settings.ts` and to `FALLBACK_SETTINGS` in `src/services/store-settings.ts`, backfilled per-field like the existing blocks
- [x] 13.5 Call `setCurrencyFormat` in `layout.tsx` from the settings it already awaits, and add `src/components/providers/CurrencyFormatProvider.tsx` to do the same in the browser
- [ ] 13.6 Verify in a browser that a server-rendered price (product grid) and a client-rendered one (cart drawer) agree, on a store configured `$`/AFTER/0 decimals
- [x] 13.7 Verify the fallback: with the settings endpoint unreachable, every price still renders with a symbol and never as a bare number

## 14. Frontend — Blog

- [x] 14.1 Add `src/types/blog.ts` and `src/services/blog.ts` with a 5-minute revalidate and the `blog-posts` cache tag, following `src/services/banner.ts`
- [x] 14.2 Add `"blog-posts"` and `"testimonials"` to `ALLOWED_TAGS` in `src/app/api/revalidate/route.ts`
- [x] 14.3 Rewrite `BlogSection.tsx` to render the four newest published posts from the API, showing `videoThumbnailUrl` with a play badge for a video post and no media area for a post with none
- [x] 14.4 Point each card's "Read more" at `/blogs/<slug>`
- [x] 14.5 Rewrite `src/app/blogs/page.tsx` to list published posts from the API with pagination, replacing the fixture list that currently repeats itself to look fuller
- [x] 14.6 Add an empty state to the index for a shop with nothing published, rather than a bare heading
- [x] 14.7 Add `src/app/blogs/[slug]/page.tsx`: media (video player for a video post), title, date, sanitised body through the same component `Page` already uses, and `generateMetadata` falling back to title/excerpt
- [x] 14.8 Return `notFound()` for an unknown or unpublished slug
- [x] 14.9 Verify a body containing a `<script>` is neither executed nor present in the rendered document

## 15. Frontend — Testimonials

- [x] 15.1 Add `src/types/testimonial.ts` and `src/services/testimonials.ts` with the same caching shape as blog
- [x] 15.2 Rewrite `Testimonials.tsx` to render published entries from the API, pass each entry's own rating to `StarRating` in place of the hardcoded `5`, and render the author photo with an initials fallback
- [ ] 15.3 Confirm a card with no photo occupies the same footprint as one with a photo, so a mixed row does not stagger

## 16. Frontend — homepage wiring and fixture removal

- [x] 16.1 Fetch both sections' content in `src/app/page.tsx` alongside the existing concurrent product queries, each resolving rather than rejecting on failure so one outage cannot fail the page
- [x] 16.2 Render `<Testimonials />` and `<BlogSection />` only when their content is non-empty, matching how the merchandising rows are already gated
- [x] 16.3 Delete `blogPosts` and `testimonials` from `src/data/content.ts`; **`grep -rn "blogPosts\|testimonials" frontend/src/data` must return zero matches**
- [x] 16.4 Verify the homepage on an unseeded shop: no blog heading, no testimonials heading, and no gap where they were

## 17. Postman and verification

- [x] 17.1 Update `server/postman/Ecom.postman_collection.json` for the settings payload changes (currency fields in, tax rate out, nullable threshold) and add folders for the blog-post and testimonial endpoints with example bodies for each media type
- [x] 17.2 Copy the collection byte-identically to `admin/postman/` and `frontend/postman/`, then confirm all three match
- [x] 17.3 Run `pnpm -C server verify:postman` and confirm it passes
- [x] 17.4 Run `pnpm lint`, `pnpm test` and `pnpm build` from the root across all three apps
- [ ] 17.5 Walk the storefront once fully configured — non-default currency, published posts of both media types, published testimonials — and once completely empty, confirming the empty case is a shorter page rather than a broken one
- [x] 17.6 Confirm the deploy order in design.md still holds: server deployed alone leaves the current admin and frontend working, and the frontend's `FALLBACK_SETTINGS` covers a frontend newer than the server

---

## Outstanding — three manual checks not performed

**13.6, 15.3 and 17.5's "fully configured" half are NOT done.** Each needs either content seeded into
the database or the store's currency changed, and that seeding was not carried out. What was done
instead, and what is left:

**17.5 — empty half: VERIFIED.** Both new tables are empty, so the live storefront was the unseeded
case exactly. Against it: the homepage omits both the blog and the testimonials section entirely (no
heading, no grid), no fixture content leaks in their place, the surrounding sections render normally,
`/blogs` returns 200 with its "no posts yet" copy rather than a bare heading, and `/blogs/<unknown>`
returns 404.

**17.5 — fully-configured half: NOT DONE.** Nothing has been published, so the populated page has
never been rendered. What backs it in the meantime is `verify:blog`, which drives the same service
layer the pages read: draft invisibility, the media switch clearing the columns it does not use,
slug conflicts, and the rating bounds.

**13.6 — NOT DONE.** The server/client agreement was not observed in a browser on a `$`/AFTER/0
store. What IS verified: prices on the live storefront render as `৳1,090.00` — symbol present,
thousands grouped — and 13 unit tests in `src/lib/format.test.ts` pin every position/decimal
combination including the non-breaking space. The specific risk left unchecked is hydration: the
layout sets the format on the server and `CurrencyFormatProvider` sets it again in the browser, and
only a non-default currency would expose a mismatch between the two.

**15.3 — PARTIALLY VERIFIED, statically.** The photo and the initials fallback in `Testimonials.tsx`
carry the same `size-10 shrink-0 rounded-full` classes, so their footprints are identical by
construction. The visual confirmation that a mixed row does not stagger was not made.

To close all three: publish one image post, one video post and two testimonials (one with a photo,
one without), set the currency to `$` / AFTER / 0 decimals, and load `/`, `/blogs`, `/blogs/<slug>`
and `/cart`.
