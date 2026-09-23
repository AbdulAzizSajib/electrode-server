## Context

See proposal.md — Why. Four things already in place shape the approach, and the design is mostly a matter of not building a second copy of any of them.

**The per-section layout registry exists on all three sides.** The server's `HOME_SECTION_VARIANTS` is a `Partial<Record<HomeSectionKey, readonly [string, ...string[]]>>` — a section that offers a choice lists its layouts, position 0 is the default, and a section absent from the map refuses a layout on write. `homeConfigSchema` narrows the value per key from that map, and `resolveSectionVariant` is the one implementation of "absent, unrecognised, or withdrawn → the section's default", shared by the reconciler and the verify script. None of it is hero-specific except the single entry in the map. The two frontends mirror the map by hand: the storefront in `HERO_VARIANT_KEYS` / `resolveHeroVariant`, the admin in `HeroVariant` / `HERO_VARIANT_OPTIONS`. Both are hero-shaped in name and type, and that is the only thing about them that has to change.

**The hero settled the storefront's rendering pattern.** `Hero` is a Server Component that fetches once, slices to the chosen layout's capacity, and hands props to a layout component; `hero/registry.ts` is a `Record<HeroVariant, { Component, Skeleton, … }>` so TypeScript reports a layout shipped without its placeholder; the slider half is a Client Component because Swiper needs the browser and the fetch does not; and the page builds the section from its config entry so the Suspense fallback can be the placeholder shaped like the chosen layout. `CategoryGrid` today is a single Server Component with the fetch and the grid markup in one file.

**The admin's Home Sections row already has a per-section settings panel.** The row takes an optional `settings` node revealed by a disclosure control, used today by the newsletter's copy fields; the panel is rendered as a sibling of the draggable row, not a child, because a form control inside a `draggable` ancestor cannot be selected with the mouse. The page holds `homeConfig` in a `useSettingsDraft`, writes it wholesale on save, and — since the hero change — carries every stored entry through untouched rather than rebuilding `{ key, enabled }`, which is what keeps a field this page does not edit from being wiped by a save from it. `hero-variant-preserved.test.tsx` pins that.

**The hero's picker is four diagram cards over a Radix radio group**, with two hard-won rules in its comments: the card must not declare `h-full` (a percentage height on a grid item resolves circularly and one card renders taller than the rest), and the group must not be disabled from the shared settings mutation's `isPending`.

Also in force: the storefront's Vitest suite is `node`-environment over `src/lib` only, so anything that must be proven has to be a pure module; Swiper is already a dependency, imported by `HeroSlider`; and `container-px site-container` plus `grid-cols-3 sm:grid-cols-4 lg:grid-cols-7` with `gap-4` is the grid's geometry — three, four and seven tiles across at the three breakpoints, 16px apart.

## Goals / Non-Goals

**Goals:**

- A merchant can put the category tiles in one scrolling row instead of a wrapping grid, from the screen that already owns the rest of the homepage's arrangement.
- `GRID` renders byte-identical markup to today. Every shop that never opens the control is unaffected, on the storefront and in the admin.
- The second section to offer layouts costs one registry entry per side plus its components — no new mechanism, no new endpoint, no new page.
- The same tiles at the same size in both layouts, so the choice reads as an arrangement and not as a different section.

**Non-Goals:**

- A general "layout picker" page or a settings card above the section list. Two options with no downstream consequence do not earn a screen.
- Choosing which categories are featured, or capping how many appear. The category service decides that today and is untouched.
- Per-layout data. Both layouts call the same fetch and render the same list.
- Autoplay, looping, or pagination dots on the slider. See Decision 4.
- Layouts for any other section. Product rows are a later slice, and they should be built on whatever this change leaves behind.

## Decisions

### 1. One registry entry on the server, not a new column or a new mechanism

**Chosen:** `FEATURED_CATEGORIES_VARIANTS = ["GRID", "SLIDER"] as const` beside `HERO_VARIANTS`, and `FEATURED_CATEGORIES: FEATURED_CATEGORIES_VARIANTS` added to `HOME_SECTION_VARIANTS`. Nothing else on the server changes: validation, reconciliation, resolution and the public read are all generic over that map.

This is the hero change's Decision 1 and 2 paying off, and the whole reason the map is per-key rather than a flat union. The alternative — a `featuredCategoriesLayout` column on `StoreSetting` — was rejected for the hero for reasons that apply here unchanged: it would be a second place a section's arrangement lives, the admin's disjoint-key discipline would need a new editor for one string, and `GET /settings/public` serves the row with `findUnique`, so every column is one careless edit from being published.

`GRID` is position 0 because it is the arrangement the section has always rendered. Reorder the tuple and every shop that never opened the control restyles — the same warning `HERO_VARIANTS` carries, repeated on this tuple.

The verify script is generalised rather than duplicated: `verify-hero-section-variants.ts` iterates `HERO_VARIANTS` directly in three places; it becomes `verify-section-variants.ts` iterating every key of `HOME_SECTION_VARIANTS`, so the second section is covered by the same round-trip, rejection and read-only checks as the first, and a third will be too without editing the script.

### 2. The picker lives on the Home Sections row, and the hero's stays where it is

**Chosen:** the Featured categories row gets a `settings` panel holding the layout picker. Saved by the page's existing Save bar as part of `homeConfig`. The hero's row keeps its read-only line and link; the hero's picker stays on Home Slider.

The hero's Decision 2 put its picker on Home Slider *away* from the page that owns `homeConfig`, and accepted a two-editor collision to do it. The reasoning was specific: choosing a hero layout changes the upload sizes and the slot shapes, which only Home Slider can show, and a merchant who picks a layout somewhere those consequences are invisible never notices they changed. None of that applies to a grid-versus-slider choice for category tiles. The tiles are the same size in both; there is no artwork guidance to move; there is nothing a dedicated screen could draw that a small diagram cannot. So the tidy answer the hero had to reject is the right one here — the page that owns and writes `homeConfig` also edits this field of it, and the collision the hero accepted is not introduced a second time.

The row's existing disclosure panel is the mount, not a new row layout. It is already rendered outside the draggable subtree for a reason that applies to a radio group as much as to a text input, and it is already offered regardless of `section.enabled` — a merchant arranges a section before switching it on — which the spec now requires of the layout too.

**Rejected:** a card above the list, like the hero picker on Home Slider. It would separate the control from the row it governs on a screen whose whole design is one row per section. **Rejected:** offering the hero's layout here as well, now that the row has a panel. Two screens writing the same field with only one able to show what the answer means is exactly what the hero change refused, and the reason has not changed.

### 3. The card shell is shared with the hero picker; the diagrams are not

**Chosen:** the radio-group-of-cards shell — the Radix `Root`/`Item`, the selected and pending states, the no-`h-full` rule and its comment, the label/description/footer slots — is extracted from `variant-picker.tsx` into a `LayoutPicker` in `features/ui/components/`, generic over the option key. The hero passes its four diagrams and its per-slot size list as the footer; Featured categories passes two diagrams and no footer. Each feature keeps its own diagrams, because a diagram is a drawing of one specific arrangement and there is nothing to share.

The same card in two places is the failure class this panel keeps hitting — the picker has been wrong three times in one week, each time in the shell rather than the diagrams, and each fix is a comment that would have to be maintained twice. The existing `variant-picker.test.tsx` pins the shell's behaviour (a click reports the right option, a save in flight leaves the other cards live, no percentage heights, one `viewBox` across diagrams) and must pass unchanged after the extraction; that is the guard on the refactor. The diagrams' `Slot` primitive and the 19:8 `BOX` stay with the hero — they encode the hero's geometry, not a drawing convention.

**Rejected:** a second, smaller picker component for two options. It would be the fourth copy of a card whose three previous copies each had a bug. **Rejected:** making the hero picker itself take an `options` prop and reusing it whole. Its footer is the hero's size list, its diagrams import hero geometry, and its `saving` prop exists for a save that Home Sections does not make — the hero-specific parts outnumber the shared ones.

The two diagrams: `GRID` is two rows of small boxes; `SLIDER` is one row of the same boxes running off the right edge, with the last box clipped so that "it continues" is the first thing read. Both are drawn at the same box size so the cards line up.

### 4. The slider is Swiper, with the grid's own breakpoints, and it does not move by itself

**Chosen:** a `CategorySlider` Client Component on `swiper/react`, with `slidesPerView` of 3 / 4 / 7 at the grid's `sm` and `lg` breakpoints and `spaceBetween: 16` — the grid's `gap-4` — so a tile is the same width in both layouts at every viewport. The `Navigation` module for the visible control the spec requires. No `Autoplay`, no `loop`, no `Pagination`.

Matching the grid's column counts is the rule the hero just settled for itself, transposed: the layouts share one box and one tile size and differ only in arrangement, so switching reads as a rearrangement rather than as a different section. It also means the tile component is genuinely shared — extracted as `CategoryTile`, used by both, with the grid's markup carried over verbatim so `GRID` is byte-identical.

No autoplay because categories are navigation. The hero's slides are promotions, where motion earns attention; a row of links that slides under the pointer as a shopper reaches for one is a mis-click waiting to happen, and there is no promotional reason to accept that. No loop because a shopper who reaches the end of fourteen categories should be able to tell they have.

**Rejected:** CSS `overflow-x: auto` with `scroll-snap`, no library. It is lighter and would need no client component; it was rejected because the request names Swiper, because Swiper is already loaded on this page by the hero so it costs nothing extra, and because the navigation arrows the spec requires are free with the module and hand-built without it. It remains the right answer if the hero ever stops using Swiper.

The slider needs the browser, so — as with `HeroSlider` — the fetch stays in the Server Component and the client half receives the list as props. Swiper renders its initial markup on the server, so the row is present in the HTML and does not pop in.

### 5. The storefront's resolver becomes per-section; the page builds this section from its entry

**Chosen:** `lib/hero-variants.ts` becomes `lib/section-layouts.ts`: a `SECTION_LAYOUTS` map mirroring the server's `HOME_SECTION_VARIANTS` — `HERO` and `FEATURED_CATEGORIES`, each an ordered tuple, position 0 the default — and one `resolveSectionLayout(key, value)` over it with the hero resolver's exact rule. `resolveHeroVariant` is deleted and its two call sites updated; the existing test file is renamed and generalised, and the withdrawn-`SPLIT_ONE` case it pins stays.

This is the hero change's Decision 5 with the key made a parameter. The alternative — a second `resolveFeaturedCategoriesLayout` beside the first — is the same rule written twice, and the storefront's whole defence against a newer server is that rule being right.

`types/store-settings.ts` gains `FeaturedCategoriesLayout = "GRID" | "SLIDER"` and `HomeSection.variant` widens from `HeroVariant` to `HeroVariant | FeaturedCategoriesLayout`. `FALLBACK_SETTINGS.homeConfig` gains `variant: "GRID"` on the section, for the reason its hero entry carries `"SPLIT_THREE"`: that list stands in for a settings read that never happened, so there is no server answer to defer to, and an outage should serve the grid the shop has always had.

`CategoryGrid.tsx` becomes `FeaturedCategories.tsx` on the `Hero` pattern — one fetch, the enabled-and-non-empty rule, then the layout component from `categories/registry.ts` (`Record<FeaturedCategoriesLayout, { Component, Skeleton }>`). The page builds the section from its config entry as it does for the hero, so the Suspense fallback is the skeleton shaped like the chosen layout. `CategoryGridSkeleton` is kept as the grid's; a `CategorySliderSkeleton` is one row of seven at the same tile shape, `overflow-hidden`.

### 6. The admin carries the layout through the draft, and edits nothing else to do it

**Chosen:** the panel's picker reads `section.variant` from the draft and writes it through the same per-section update path the enabled switch uses. No new state, no new save. `HOME_SECTION_REGISTRY`'s description for the section is rewritten from "The grid of category tiles customers browse from" to name what the section *shows* without naming one arrangement. `FEATURED_CATEGORIES_LAYOUT_OPTIONS` sits beside `HERO_VARIANT_OPTIONS`, in registry order, with merchant-facing labels and one-line descriptions.

The one hazard is the one the hero change found: a save from this page must not drop a stored layout. The page already carries whole entries through normalisation, and the existing test drives the real page to prove the hero's layout survives an unrelated save. That test gains the second section — a stored `SLIDER` survives reordering — rather than a new file, because the guarantee is one rule and the two cases belong side by side.

The panel is offered regardless of `section.enabled`, exactly as the newsletter's is, and for the reason stated on that prop: a merchant may arrange a section before switching it on.

## Risks / Trade-offs

- **Three hand-maintained mirrors of the layout registry, and nothing compares them.** A layout added on the server and not in the storefront renders as `GRID`; not in the admin, it cannot be chosen. Both degrade rather than break, which is the property the resolver exists for. → Each mirror's comment names the server tuple as the authority and says position 0 is the default; the server verify script covers every section in the map, not one.
- **Tile size parity across the two layouts cannot be tested here.** The storefront's suite cannot render, and jsdom does no layout. → `slidesPerView` and `spaceBetween` are derived from the same three numbers the grid's classes state, in one place, with a comment naming the grid class string they must match. A human confirms it in a browser, and the task says so.
- **Refactoring the hero picker to extract the shell risks the control that just stabilised.** → The extraction is behaviour-preserving by construction (the hero's tests must pass unchanged), the no-`h-full` and not-`isPending` rules move with their comments, and Home Slider is checked in a browser as part of this change's verification.
- **Swiper's client bundle and CSS on a page that may render the grid.** The registry imports both layouts, so the slider's chunk ships whether or not it is used. → Swiper and its CSS are already on this route for the hero; the marginal cost is the `CategorySlider` component alone, which is small. Not worth a dynamic import's loading state.
- **A stale Home Sections draft still clobbers a hero layout chosen on Home Slider in another tab.** Pre-existing, accepted by the hero change (its Decision 2), and unchanged here. → Not widened: this change adds a field to the page that already writes the column, rather than a second writer.
- **Trade-off accepted:** the picker's row panel is smaller than the hero's page-level cards, so the two diagrams are drawn smaller. Two arrangements at two sizes is legible at that scale in a way four at four sizes would not be.

## Migration Plan

No data migration. Every stored `homeConfig` predates the field, and an absent layout resolves to `GRID` on read — which is what those shops render today.

Deploy in order: **server, storefront, admin.** The server alone is safe: an older admin cannot send the field and an older storefront renders `GRID`. The storefront next: it renders `GRID` until a value arrives. The admin last, as with the hero, so a merchant cannot choose a layout the storefront cannot yet render and see nothing change. The reverse order would also make the admin's save fail loudly — an older server refuses a layout on a section it thinks offers none — which is correct behaviour, but a merchant should not meet it.

Rollback is reverting the change in the reverse order. A `SLIDER` value already stored is read by the reverted server as unrecognised and resolved to `GRID`; nothing needs cleaning up.

## Open Questions

- Whether the slider's navigation arrows should sit inside the row at its edges (as the hero's do, overlaying the first and last tile) or outside it, beside the heading. Visual only; either satisfies the spec's "visible control", and the choice does not affect the tasks.
- Whether a very small viewport should show partial tiles at the row's right edge (a fractional `slidesPerView`, hinting at more) or exactly three. Deferrable; the breakpoints stay the grid's either way.
