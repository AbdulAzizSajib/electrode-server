## Context

See proposal.md for why. The state this design works from:

- Four places hardcode six across: `ProductSection` (homepage grid layout), `ProductSlider` (homepage slider layout, `COLUMNS = { base: 2, sm: 3, lg: 6 }` kept equal to the grid by hand — see its header comment and `add-product-slider-and-card-quantity` Decision 3), `ProductSectionSkeleton`/`ProductSliderSkeleton` in `HomeSkeletons.tsx`, and the related-products grid in `ProductDetail.tsx`. All share `grid-cols-2 gap-x-3 sm:gap-x-5 sm:grid-cols-3 lg:grid-cols-6`.
- Cards already stretch: grid tracks are `1fr`, and the slider's `slidesPerView` divides the row. Changing the column count alone resizes the card — there is no fixed card width to undo.
- `ProductCard`'s image carries `sizes="(min-width: 1024px) 320px, …"`, which is right for six across a ~1920px container and too small for four.
- `catalogConfig` is a flat JSON blob, read server-side with a per-key spread over `DEFAULT_CATALOG_CONFIG` and on the storefront with a per-key spread over `FALLBACK_SETTINGS.catalogConfig`. Its write schema is `.strict()` with every key required. The storefront exposes it through `getCatalogFeatures()`, set in the root layout on the server and by `CatalogFeaturesProvider` in the browser, so server and client components both read it without props.
- The homepage requests `SECTION_SIZE = 12` products per row; the product page requests 6 related products.
- Tailwind v4 builds its stylesheet by scanning source for literal class names — `lg:grid-cols-${n}` produces no CSS. `components/home/promo/layouts.ts` already documents and solves this with a map of literal strings.

## Goals / Non-Goals

**Goals:**
- One value drives the grid, the slider, the skeletons, the product request size and the image `sizes`, so they cannot disagree.
- A missing, malformed or unread value renders exactly today's storefront.

**Non-Goals:**
- A per-section or per-page column count.
- Changing the gap, card internals, or the `sm` and base column counts.
- Making `/products`, `/deals`, wishlist, compare or Deal of the Week configurable.

## Decisions

### 1. A key on `catalogConfig`, not a theme token or a `homeConfig` variant

`productGridColumns: 4 | 5 | 6`. `catalogConfig` already holds what a listing presents (wishlist, compare, quick view, cart-on-add, card quantity), the admin already has a page for it, and both read paths already default a missing key per-key, so no service code changes. 

Rejected: `theme` — it is colours and fonts interpolated into CSS variables; a column count is not a CSS variable here because it also drives a fetch size. `homeConfig` variants — those are per section, and the related-products grid is not a homepage section.

A number rather than an enum string (`"FOUR"`): it is consumed arithmetically (slidesPerView, rows, `sizes`), and Zod `z.union([z.literal(4), z.literal(5), z.literal(6)])` closes the set just as tightly. The allowed values live in one tuple, `PRODUCT_GRID_COLUMNS = [4, 5, 6] as const`, mirrored by hand in the admin and storefront.

### 2. Required on write, defaulted on read

Same as every other `catalogConfig` key: required by the strict write schema so a save is unambiguous, and defaulted on read so a row saved before the key existed reads at 6. Rejected: optional on write — it would let an old admin keep saving, but then "absent" on write would silently mean "reset to 6", and the schema's one-screen-one-complete-write rule would have its first exception.

The storefront additionally coerces any value outside {4, 5, 6} to 6 when it reads the payload, so a hand-edited row cannot produce a grid class that was never generated.

### 3. One storefront module owns every per-count figure

`lib/product-grid.ts` exports, for a column count:

- `PRODUCT_GRID_CLASS[n]` — the full literal class string (`"grid grid-cols-2 gap-x-3 gap-y-4 sm:gap-x-5 sm:gap-y-8 sm:grid-cols-3 lg:grid-cols-4"`, and so on for 5 and 6), written out three times so Tailwind sees each.
- `productCardSizes(n)` — the image `sizes` string.
- `homeRowSize(n)` and `relatedCount(n)` — the request sizes (Decision 5).
- `resolveGridColumns(value)` — the coercion in Decision 2.

The related grid reads `getCatalogFeatures().productGridColumns`, as `ProductDetail` already does for its other flags. The homepage instead passes `columns` down as a prop — `page.tsx` → `ProductRow` → `ProductSection` / `ProductSlider`, and to each row's skeleton — because the page already holds the settings and the row's request size is computed there; a module-scope read in a server component would also depend on the root layout having set it first. Every one of them goes through this module. The slider's `COLUMNS` stays the single place its numbers appear, now with `lg` taken from the setting; its header comment is updated to point at the module rather than at a hardcoded class string.

Rejected: an inline `style={{ gridTemplateColumns }}` at `lg` — needs a media query, so it means a CSS variable plus a custom class anyway, and splits the grid's definition between Tailwind and a stylesheet.

### 4. Image `sizes` follow the column count

At `lg` and up, `sizes` becomes `${Math.ceil(100 / n)}vw` (17vw / 20vw / 25vw). A card is never wider than the viewport divided by the column count, so this is a safe upper bound whether or not the merchant caps the content width; it over-fetches somewhat on a capped wide screen, which is the direction to err in.

`ProductCard` takes `sizes` as an optional prop and keeps today's string as its default, so `/products`, `/deals`, wishlist and compare — which render the same card in their own grids — are untouched.

### 5. Request sizes keep rows full without exceeding today's twelve

- Homepage rows: the largest multiple of the column count not above 12 — 12, 10, 12 for 6, 5, 4. Never more than today, so no extra load on the homepage's three product queries.
- Related products: one row — 6, 5 or 4.

Rejected: always 12 (five across leaves 2 orphans); 15 for five across (more than today, and an odd count leaves an orphan on a two-across phone). Ten at five across still leaves one orphan at three-across on a tablet; that is accepted, because the setting is about the large screen and tablets already end partial rows at other counts today.

The slider uses the same request size so switching a row between grid and slider never changes which products it holds.

Where the count is applied differs by page, to keep each page's fetches as parallel as they are today. The homepage already awaits the settings before building its sections, so `homeRowSize(n)` becomes the rows' `limit`. The product page starts `getRelatedProducts(handle, 6)` in parallel with everything else; making its `limit` wait for the settings would serialise that request, so it keeps fetching six and the related grid renders the first `relatedCount(n)` — six is at least one row at every allowed count.

### 6. Admin: a segmented choice on the existing Catalog settings page

A three-option radio group ("4", "5", "6 (default)") in its own card under the existing switches, with one line of body copy saying it applies on large screens to the homepage product rows and related products. It saves through the page's existing `useSettingsDraft` → `PATCH /settings { catalogConfig }`, so it joins the existing unsaved-changes guard rather than saving on change.

## Risks / Trade-offs

- [An admin built before this change saves the Catalog settings page after the server deploys] → the save is refused with a validation error naming the missing key. Mitigation: deploy server and admin together; the same window existed for `openCartOnAdd` and `cardQuantityControl`.
- [The three repos' copies of {4, 5, 6} drift] → the storefront's coercion makes an unknown value render six across rather than an ungenerated class; the server rejects it on write. Kept in step by hand, like the other `catalogConfig` mirrors.
- [Cached homepage HTML shows the old column count] → the settings save already calls `revalidateStorefront` for the settings tag; nothing new to wire.
- [Four across with very short product names leaves visibly tall image areas] → acceptable; the card's aspect ratio is unchanged and is the merchant's choice to make.
- [jsdom cannot measure layout] → card widths and slider/grid parity are checked by eye at 4, 5 and 6 on a large viewport; the pure figures in `lib/product-grid.ts` are unit-tested.

## Migration Plan

No database migration. Deploy server (accepts and publishes the key) → admin (sends it) → storefront (renders it). Each step on its own leaves the storefront at six across. Rollback is the reverse; a stored `productGridColumns` left behind by a rolled-back server is ignored by the per-key read and rejected only by a write that includes it.
