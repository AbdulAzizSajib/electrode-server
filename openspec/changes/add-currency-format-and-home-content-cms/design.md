## Context

See `proposal.md` — Why. What shapes the approach here is three properties of the existing code:

1. **`formatPrice` is called from both server and client components.** `frontend/src/lib/format.ts` exports a plain synchronous `formatPrice(value)`, used at 51 sites. Some are server components (`OrderSummaryCard`, `ProductSection`), some are client (`ProductCard`, `CartDrawer`, `CouponForm`, `CompareTable`). Any solution that only works in one of the two — a React hook, or an `await`ed settings read — is unavailable to half of them.

2. **`StoreSetting` is a singleton row.** `SINGLETON_ID = "singleton"`, upserted, never a second row. There is exactly one correct currency format per deployment at any instant. That is the property that makes the approach below sound; it would not be sound in a multi-tenant system.

3. **The UI section already has a settled shape.** `UI → Pages` is a list page plus a form page with Tiptap, slug validation against a server-held reserved list, and a status control. `UI → Header Links` / `Footer Links` / `Checkout Setting` share a draft/dirty/unsaved-guard helper (`settings-editor-utils.tsx`). Blog and Testimonials are the same shapes again; nothing new needs inventing.

Two further constraints from the existing code:

- `PATCH /settings` is a **partial upsert**. Every settings editor sends only its own keys, and that disjointness is what stops them clobbering each other. Moving the free-shipping threshold means moving a key from one editor's set to another's, not duplicating it.
- The public settings projection in `store-setting.service.ts` is an explicit **allow-list**. A new column is private until opted in, one line at a time.

## Goals / Non-Goals

**Goals**

- One currency format, resolved once per app, honoured by every existing money call site **without editing those call sites**. 51 + 91 edits is where regressions come from.
- Tax has exactly one source. After this change, reading Catalog → Tax Rules tells a merchant every tax the shop charges.
- Blog and Testimonials follow the Pages module so closely that a developer who has read one can maintain the other.

**Non-Goals**

- **Multi-currency.** One currency, one format, store-wide. Per-region pricing, conversion rates and a currency switcher are all out. `StoreSetting`'s doc comment already commits to this.
- **Locale-aware number formatting.** Grouping is Western (`1,234,567.89`) regardless of currency. Indian lakh/crore grouping, decimal-comma locales and non-Latin digits are not configurable here.
- **Configurable spacing between symbol and amount.** The rule is fixed (below) rather than a fifth knob.
- **Blog categories, tags, authors, comments, or scheduled publishing.** A post is content plus one media slot plus a status, exactly as a Page is content plus a status.
- **A page builder.** The blog body is one rich-text field, matching `Page.body`.
- **Testimonials tied to real reviews.** These are merchant-authored marketing copy. Product `Review` is a separate, verified thing and stays separate.
- **Showing the free-shipping threshold to shoppers.** It stays admin-only in the public projection; a "spend ৳X more for free delivery" nudge is its own change.

## Decisions

### 1. Currency format is resolved into a module-level holder, not threaded through call sites

`formatPrice(value)` and admin's `formatCurrency(amount)` keep their signatures. Each app gains a `setCurrencyFormat(format)` that writes a module-scoped value the formatter reads, plus a documented default it falls back to when unset.

- **Frontend**: `layout.tsx` already `await`s `getStoreSettings()` for the theme and metadata. It calls `setCurrencyFormat(...)` during render for the server pass, and renders a `<CurrencyFormatProvider format={...}>` client component that calls the same setter in its module init for the browser pass.
- **Admin**: a provider at the app root calls `setCurrencyFormat` when `useStoreSettings()` resolves. The SPA's module scope is per-tab, so this is unremarkable there.
- **Server**: `formatMoney(amount, format)` takes the format explicitly — the server has no render pass to hang a holder off, and its two call sites already have a `storeSetting` in hand.

*Why not a React hook (`useCurrencyFormat()`)?* It cannot be called from a server component, and roughly a third of the call sites are in server components. Adopting it would mean converting those to client components — pushing product grids and order summaries into the client bundle to change how a symbol renders. That is a real cost for no benefit.

*Why not an explicit second parameter (`formatPrice(value, format)`)?* Correct, and it is what the server does. On the frontend it means threading the format from the root layout through every component tree that renders a price — including client components reached through Redux-connected drawers and rails that have no props path from the layout. 51 signature changes plus prop drilling through the entire component tree, to express a value that is constant per deployment.

*Why is module scope safe on the frontend server?* Because the store is a singleton. Concurrent requests share module scope, but they all want the *same* value, so there is no cross-request leak of different data. The only reachable anomaly is a page rendered during the instant a merchant's save propagates, which could mix formats — cosmetic, momentary, and no worse than the existing 30-second settings cache. This reasoning goes in the file's doc comment, because the safety is conditional on the singleton and a future multi-tenant change must revisit it.

*Fallback:* an unset holder formats with `৳`, before, 2 decimals — today's literal. So a code path that forgets to set the format degrades to current behaviour rather than to `undefined1200`.

### 2. Grouping comes from `Intl.NumberFormat`, the symbol does not

The number part is `new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })`. The symbol is concatenated by us.

*Why not `style: 'currency'`?* Because `Intl` decides the symbol and its position from the currency code and locale, and the whole point of this change is that the merchant decides. `style: 'currency'` with `currency: 'BDT'` renders `BDT 1,200.00` in `en-US`, not `৳1,200.00`, and offers no way to move the symbol to the trailing position.

*Formatter caching:* an `Intl.NumberFormat` is constructed per distinct decimal count and memoised. Constructing one per `formatPrice` call would be a measurable cost in a grid of 40 products.

### 3. Symbol spacing is a fixed rule: none before, one non-breaking space after

`৳1,200.00` and `1,200.00 ৳`. This is what every leading-symbol locale and every trailing-symbol locale does respectively, so it will look right without a merchant thinking about it. The space is ` ` so an amount never wraps away from its symbol at the end of a line.

*Alternative rejected:* a fifth setting for spacing. A knob whose right answer is determined by the position it accompanies is a knob that is only ever set wrong.

### 4. `currencyPosition` is a Prisma enum; `currencyDecimals` is a plain `Int`

`enum CurrencyPosition { BEFORE AFTER }` — two values, closed set, and the database should say so. Decimals is `Int @default(2)` with the 0–4 bound enforced in Zod, matching how every other bounded number in this schema is handled (`maxPendingCodOrdersPerPhone`, the theme's `maxWidth`).

Both are opted into the public allow-list — the storefront cannot render a price without them.

### 5. The tax fallback is removed from the signature, not defaulted to zero

`quoteTax(lines, discountAmount)` loses its third parameter and `IChargeQuoteInput` loses `fallbackTaxPercent`. Leaving the parameter and passing `0` would leave a fallback-shaped hole for someone to fill later with a new shop-wide rate, which is exactly the arrangement being dismantled. Removing it makes the compiler enforce that both `order.service.ts` call sites are updated.

The column drop is a **separate migration from the two additive ones**, so a rollback of the destructive step does not take the currency columns with it.

### 6. `freeShippingThreshold` stays a scalar column and becomes nullable in the API

The threshold moves editing surface only. It does **not** move into the `checkoutConfig` JSON blob: it is a typed decimal the pricing path reads directly, and burying it in an unvalidated-by-Postgres blob to keep one screen's fields in one column would be the wrong trade.

The checkout settings page therefore sends `{ checkoutConfig, freeShippingThreshold }` and Store Settings stops sending the threshold — the disjoint-field-set property is preserved, just with a different partition.

**The nullability fix is required, not optional.** `updateStoreSettingZodSchema` has `freeShippingThreshold` as `.optional()`, and the current page omits a blank value from the payload. Under a partial upsert, omission means *leave unchanged* — so today a merchant who sets a threshold cannot ever unset it. The schema becomes `.nullable().optional()`, the service writes `null` when it receives `null`, and blanking the field on the new page clears the offer. Without this, moving the field would carry the bug to its new home.

### 7. Blog and Testimonials are Prisma models, not settings JSON

Every other homepage section a merchant controls is already a model — `Banner` for the hero and mid-page slots, `Page` for content pages. A JSON block on `StoreSetting` (the shape `mainNav` and `footerColumns` use) suits a short, fixed, ordered list edited as a whole. A blog is neither short nor fixed: it grows, it needs a slug index for `/blogs/<slug>`, it needs pagination, and a post's body is a rich-text document. Testimonials follow the blog rather than the settings blocks so the two new admin sections are consistent with each other.

**`BlogPost`**

| Field | Notes |
| --- | --- |
| `slug` | `@unique`; validated `^[a-z0-9]+(?:-[a-z0-9]+)*$` in Zod, as `Page` does |
| `title`, `excerpt` | Excerpt is what listings show; required, so a card is never half-empty |
| `body` | `@db.Text`, Tiptap HTML, **stored as authored and sanitised at render** — the same posture as `Page.body` and `Product.description`, stated in the model's doc comment |
| `mediaType` | `enum BlogMediaType { NONE IMAGE VIDEO }` |
| `imageUrl`, `videoUrl`, `videoThumbnailUrl` | All nullable; a Zod `superRefine` enforces that the set matches `mediaType`, which is the invariant Postgres cannot express |
| `publishedAt` | Merchant-set, defaults to now; the date on the card and the sort key |
| `metaTitle`, `metaDescription` | Nullable, falling back to `title` / `excerpt` at render |
| `status` | `enum BlogPostStatus { DRAFT PUBLISHED }` |

*Why `mediaType` rather than inferring from which URL is set?* Because "image or video, never both" is then a rule the data states rather than one three nullable columns imply. A row with both URLs populated has an unambiguous answer to what it shows.

*Slug reservation:* posts live under `/blogs/<slug>`, a namespace of their own, so `RESERVED_SLUGS` (which guards the storefront **root**) does not apply and is not consulted. `blogs` is already in that list, so no top-level route is being added.

**`Testimonial`**

`quote` (Text), `authorName`, `authorRole`, `photoUrl` (nullable), `rating Int` (1–5 in Zod), `status` (`enum TestimonialStatus { DRAFT PUBLISHED }`), `sortOrder Int @default(0)`, timestamps. Ordered `sortOrder asc, createdAt desc` — same convention as `Banner`.

### 8. Both new modules copy the Page module's route shape

Literal segments above the dynamic one, admin routes gated by `checkAuth(OWNER, ADMIN)`, public routes returning published rows only:

```
GET    /blog-posts/admin          (admin, any status, paginated)
GET    /blog-posts/admin/:id      (admin)
POST   /blog-posts                (admin)
PATCH  /blog-posts/:id            (admin)
DELETE /blog-posts/:id            (admin)
GET    /blog-posts                (public, PUBLISHED only, paginated)
GET    /blog-posts/:slug          (public, PUBLISHED only)

GET    /testimonials/admin        (admin, any status)
GET    /testimonials/admin/:id    (admin)
POST   /testimonials              (admin)
PATCH  /testimonials/:id          (admin)
DELETE /testimonials/:id          (admin)
GET    /testimonials              (public, PUBLISHED only, ordered)
```

The `/admin` literal must be declared before `/:slug`, or `/blog-posts/admin` resolves as "the published post whose slug is `admin`" and 404s. `page.route.ts` carries this warning; both new route files repeat it.

### 9. Media upload reuses the existing endpoints unchanged

`POST /uploads/image` and `POST /uploads/video` already exist, are already `OWNER|ADMIN|STAFF`, and the video endpoint already derives a poster frame when none is supplied. The blog form uploads first and PATCHes the returned URL, exactly as Site Setting does for its logos. No new upload surface.

### 10. Storefront caching mirrors the settings pattern

Two new tags, `blog-posts` and `testimonials`, added to the frontend's `ALLOWED_TAGS` and invalidated from the two services via `revalidateStorefront`. Revalidate window: **five minutes**, matching banners and the category tree rather than settings' 30 seconds. The reasoning in `store-settings.ts` for the shorter window is that a merchant edits their theme and reloads immediately to check it — that is much less true of publishing an article, and the tag invalidation makes a save visible immediately anyway.

### 11. A video post shows its poster in listings

Homepage cards and index cards render `videoThumbnailUrl` inside the existing `aspect-4/3` frame with a play badge over it; the post's own page renders the player. Four autoplaying videos above the fold is a bandwidth and layout-shift cost the merchant did not ask for when they uploaded a video.

### 12. `data/content.ts` fixtures are deleted, not left dormant

`blogPosts` and `testimonials` go. A fallback array behind an empty API would mean an unseeded shop silently shows someone else's stock content and a merchant cannot tell "not published yet" from "broken" — and the specs require the sections to be *absent* when nothing is published, which a fixture fallback would make unreachable.

## Risks / Trade-offs

**[Order totals drop where a non-zero shop-wide tax rate was in use]** → The single genuinely destructive part of this change. Mitigated by ordering: read the stored value and reproduce it as a Tax Rule *before* the migration runs, and treat a non-zero reading as a blocker on proceeding until the rule is assigned. A shop reading 0 — the default, and the likely value — is unaffected.

**[Module-scoped currency format is subtle]** → The soundness depends on `StoreSetting` being a singleton. Mitigated by a doc comment stating that dependency explicitly and by the fallback: the failure mode of the mechanism not being wired is "prices render as they do today", not "prices render broken".

**[Storefront prices visibly change on deploy]** → `৳1200.00` becomes `৳1,200.00` everywhere, with no setting change by the merchant. Deliberate and stated in the proposal; worth a line in the release note so it is not filed as a bug.

**[Decimal places invite a false expectation]** → A merchant setting 0 decimals may expect to be charging whole amounts. Mitigated by the inline note on the field, and by the spec pinning the behaviour: display only, storage unchanged.

**[Two more admin CRUD sections to keep current]** → Blog and Testimonials are the fifth and sixth things under UI. Mitigated by both being near-copies of Pages and by reusing its list/form/status/upload components rather than growing parallel ones.

**[Blog body is stored unsanitised]** → Consistent with `Page.body` and `Product.description`, and deliberate: sanitising on write leaves everything already stored, or written by any other path, trusted forever. The guarantee is enforced at the browser boundary via the storefront's existing `sanitize-html.ts`. The risk is a new render path forgetting to call it — mitigated by routing the blog detail page's body through the same component `Page` already uses.

## Migration Plan

Ordered, because step 2 is destructive and its safety depends on step 1.

1. **Before any migration**: read `SELECT "defaultTaxRatePercent" FROM "StoreSetting"`. If non-zero, create a Tax Rule of that percentage in Catalog → Tax Rules and assign it to every product with no rule. Verify a test order's tax is unchanged. If zero, record that and continue.
2. **Migration A (additive)**: `currencyPosition`, `currencyDecimals`, with defaults matching today's rendering (`BEFORE`, `2`). Deployable on its own; changes nothing until the code reads them.
3. **Migration B (destructive)**: drop `defaultTaxRatePercent`. Ships with the `quoteTax` signature change in the same release, since the column and its only reader go together.
4. **Migration C (additive)**: `BlogPost`, `Testimonial` and their enums. Empty tables, so the storefront sections are absent until a merchant publishes — which is the specified behaviour, not a gap.

**Rollback**: A and C are dropped cleanly. B is the one-way step — restoring the column restores a zero-valued default, not the merchant's original rate, so the value recorded in step 1 is the thing to keep. Because step 1 moves the tax onto a Tax Rule first, a rollback of B lands on `0` and totals stay correct either way.

**Deploy order across the three apps**: server first (new columns and endpoints, tolerant of older clients), then admin and frontend in either order. The frontend's `FALLBACK_SETTINGS` covers the window where it is newer than the server.
