## Why

The homepage's Featured Categories section renders one way: a seven-across grid of every active category that has an image. That was the right shape for a shop with seven categories and the wrong one for a shop with fourteen — the grid becomes two full rows, roughly 430px of tiles between the hero and the first product row, and the merchant's only lever is to remove categories from the storefront to shorten it. A merchant with a deep catalogue wants the same tiles in one scrolling row, and has no way to say so.

The mechanism for this already exists and was built to be reused. `add-hero-section-variants` made a homepage section's arrangement a merchant setting: a per-section registry of layouts on the server, a picker in the admin, a registry of layout components in the storefront, and one resolution rule shared by all three so an unrecognised value always renders the section's default rather than nothing. That change named "the category grid" as the next slice in its own non-goals. This is that slice.

## What Changes

- **`FEATURED_CATEGORIES` gains two layouts**, chosen by the merchant:
  - `GRID` — the section exactly as it renders today, byte-identical, and the default. A shop that never opens the control sees no change.
  - `SLIDER` — the same tiles, the same categories, in one horizontal row that scrolls, built on the Swiper the hero already ships. Tiles are the same size in both layouts at every breakpoint, so a merchant switching sees the arrangement change and nothing else.
- **Server**: the section is registered in `HOME_SECTION_VARIANTS` as offering `["GRID", "SLIDER"]`. Validation, reconciliation and read-time resolution are already generic over that registry, so no schema change, no migration, and no change to the settings endpoints — a stored `homeConfig` without a layout on this section keeps meaning "the grid you already had".
- **Storefront**: `CategoryGrid` becomes a layout-dispatching section on the `Hero` pattern — one fetch in a Server Component, a registry of two layouts each paired with its own skeleton, and the slider half as a Client Component because Swiper needs the browser and the category fetch does not. The hero-only layout resolver generalises to a per-section one, with the same rule: absent, unrecognised, or from a newer server → the section's default.
- **Admin**: the Featured categories row on **Home Sections** gains a settings panel holding a two-option layout picker — diagram cards, as the hero's picker draws its options — saved by that page's existing Save bar. The picker lives here and not on a page of its own because, unlike the hero, this choice changes no artwork guidance and has no consequence a separate screen could show; and because this page already owns and writes `homeConfig`, so a second editor of that column is avoided rather than introduced. The registry's description of the section, "The grid of category tiles", is rewritten — it describes one layout as though it were the only one.
- **Both frontends' types**: a section entry's `variant` widens from the hero's union alone to a per-section union, and the admin's normalisation that already preserves the hero's layout through a save is confirmed to preserve this one too — it carries whole entries, not named fields, which is what the hero change's test pinned.

Stated because their absence is deliberate:

- **No autoplay on the slider.** Categories are navigation, not promotion; a navigation target that moves under the pointer is hostile, and the hero's autoplay exists for artwork, not links.
- **No per-layout category set.** Both layouts render the same categories in the same order. A layout decision never costs data — the rule every section change in this repo follows.
- **No new admin page and no page-level picker card.** Two options with no downstream guidance do not earn a screen.
- **No change to which categories appear** or how they are chosen; that is the category service's rule and is untouched.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `storefront-home-sections`: extends the homepage section registry so that a section may offer a closed set of layouts, with position 0 the default; declares `FEATURED_CATEGORIES` as offering `GRID` and `SLIDER`; requires the merchant to choose it from the Home Sections screen and the storefront to render the chosen one, with any unrecognised or absent value rendering the default. The main spec for this capability is still carried as the pending delta in `openspec/changes/add-homepage-section-toggles`; this delta adds requirements alongside it and modifies none of its existing ones.

## Impact

- **server** — `src/app/module/store-setting/store-setting.constant.ts`: one entry in `HOME_SECTION_VARIANTS` and a `FEATURED_CATEGORIES_VARIANTS` tuple beside `HERO_VARIANTS`. `scripts/verify-hero-section-variants.ts` is generalised to iterate every section in the registry so the second section is covered by the same DB-free checks as the first. No route, controller, service, validation or Prisma change.
- **nextjs** — `src/components/home/CategoryGrid.tsx` → a section component plus `categories/` registry, a shared tile, a slider Client Component and a slider skeleton; `src/lib/hero-variants.ts` → a per-section resolver; `src/types/store-settings.ts` and `src/services/store-settings.ts` (types and the `FALLBACK_SETTINGS` default); `src/app/(shop)/page.tsx` builds the section from its config entry as it already does for the hero. Swiper is an existing dependency.
- **admin** — `src/lib/api/store-settings.ts` (type, options, registry description); `src/features/ui/home-sections/home-sections-page.tsx` (the settings panel and the draft carrying the layout); a small picker component under `home-sections/`; the existing `hero-variant-preserved.test.tsx` gains the second section. No route or nav change.
- **Tests** — server verify script; storefront `hero-variants.test.ts` generalised; admin picker and preservation tests.
- **Ships in one release across the three apps.** Server first is safe in isolation (an admin that cannot offer the choice and a storefront that resolves the value to `GRID` both degrade correctly); the admin ships last, as with the hero, so a merchant cannot choose a layout the storefront cannot yet render.
