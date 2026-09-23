## Why

**The homepage is the only merchant-facing surface that is not merchant-controlled.** Every block on it — Hero, Brand Bar, Featured Categories, Best Selling, Mid Banners, Featured Products, Perks Bar, Deal of the Week, New Arrivals, Testimonials, Blog — is hardcoded into `nextjs/src/app/(shop)/page.tsx` in a fixed order, rendered unconditionally. A merchant who does not blog still ships a Blog section. A merchant with no testimonials still ships the heading. A merchant who wants Best Selling above the fold cannot have it.

Today the only lever is emptiness: a section disappears when its query returns nothing. That is a *data* accident, not a merchant decision, and the two are not interchangeable. `BrandBar` and `PerksBar` read from a hardcoded `src/data/content.ts` and can never be empty, so they can never be removed. And "delete all your testimonials so the section goes away" destroys content to change a layout.

The seller needs to say which sections their homepage has, and in what order, without a developer and without deleting anything. Every other presentation decision in this system — the theme, the checkout fields, the catalog extras, the header and footer links — is already a setting. The homepage is the gap.

## What Changes

### The homepage becomes an ordered, toggleable list of sections

- A new **home page config** setting: an ordered list of the homepage's sections, each with an on/off flag. The order of the list is the order the storefront renders them in.
- **Eleven sections** are addressable, each by a stable key that never changes once shipped: `HERO`, `BRAND_BAR`, `FEATURED_CATEGORIES`, `BEST_SELLING`, `MID_BANNERS`, `FEATURED_PRODUCTS`, `PERKS_BAR`, `DEAL_OF_WEEK`, `NEW_ARRIVALS`, `TESTIMONIALS`, `BLOG`.
- **Scope is the homepage only.** Header, Footer, the announcement bar, the cart drawer and the mobile bottom nav are site-wide chrome rendered by `(shop)/layout.tsx` on every route; a toggle that removed navigation from the entire site is a different and much larger decision, and is explicitly out of scope here.
- **The default is every section on, in exactly today's order.** The migration is additive with no backfill and changes no storefront's rendering on deploy.

### Turning a section off stops its data fetch, not just its markup

- The homepage currently fetches six payloads concurrently before rendering anything. A disabled section's query is **not issued** — hiding a section makes the page cheaper, rather than paying for data that is then thrown away.
- This is the one behaviour that cannot be retrofitted by wrapping components in a conditional, and it is why the config is read before the fetches rather than beside the JSX.

### An unknown key is ignored; a missing key renders at its default

- New sections will ship after a merchant's config is already stored. A stored config is therefore **reconciled against the section registry on read**: keys the registry no longer knows are dropped, and sections the registry has that the stored list does not are appended in their registry position, enabled.
- This is what lets a section be added in a later release without a data migration and without a merchant's saved order being discarded. Without it, shipping a twelfth section would either crash on an unknown key or silently never render it.

### A section that is ON but has no data still collapses

- The existing emptiness guards stay. Enabled means "the merchant wants this section"; it does not promise the section has content. An enabled Blog section with no published posts renders nothing, exactly as today — a heading over an empty grid is worse than a shorter page.
- The two conditions are **independent and both required**: ON and non-empty renders; either one false does not.

### Admin: one drag-to-reorder editor

- A new `UI → Home Sections` page: the eleven sections as a reorderable list, each row a drag handle, a label, a one-line description of what the section shows, and a switch.
- Follows the established settings-editor pattern (`useSettingsDraft` + `useUnsavedChangesGuard`, `EditorActions`, `UnsavedChangesDialog`), writing **only** its own key through the partial `PATCH /settings` so it cannot clobber the other seven editors.
- Turning every section off is **allowed** and is not an error state — the admin says plainly that the homepage will be empty rather than refusing the save. A merchant running a campaign may legitimately want it.

**Not breaking.** `GET /settings/public` gains one field and removes none. Existing rows have no stored config and resolve to the full default list, reproducing today's homepage exactly.

## Capabilities

### New Capabilities

- `storefront-home-sections`: which blocks the storefront homepage is composed of and in what order — the closed section registry and its stable keys, how a stored configuration is reconciled against that registry on read, the relationship between a section being enabled and a section having content, the guarantee that a disabled section costs no data fetch, what an all-sections-off homepage renders, and how the merchant edits the order and the flags from one screen.

### Modified Capabilities

None. The homepage's composition has never been specified in a root `openspec/specs/` capability — `(shop)/page.tsx` was written before the spec workflow covered the storefront, and the sections it renders appear in no existing spec's requirements. The capability above carries them going forward. The `LANDING_PAGE` site-mode redirect at the top of that route is untouched and unrelated: it short-circuits before any section is considered.

## Impact

**server/**
- `prisma/schema/StoreSetting.prisma`: one additive nullable `Json` column, `homeConfig`, with the `///` doc-comment stating the read contract (reconcile against the registry — **not** a wholesale `merge()`, and not the flat per-key spread `catalogConfig` uses either, since this value is an ordered array). One migration — **strip the three `DROP INDEX` lines and carry the NOTE block forward**, per `CLAUDE.md`.
- `store-setting.constant.ts`: the section registry (keys in default order) and `DEFAULT_HOME_CONFIG` derived from it, plus the new key on `DEFAULT_PUBLIC_SETTINGS`.
- `store-setting.validation.ts`: `homeConfigSchema` — `.strict()`, keys constrained to the registry enum, no duplicates. Postgres constrains none of this, so Zod is the only gate.
- `store-setting.service.ts`: the reconciliation step in the public projection, and `revalidateStorefront(STORE_SETTINGS_TAG)` already fires on every settings write, so no new cache tag is needed.
- New `scripts/verify-home-config.ts` covering reconciliation: unknown key dropped, missing key appended enabled, stored order preserved, null resolves to the full default.

**nextjs/**
- `src/types/store-settings.ts` and `src/services/store-settings.ts`: the new type plus its `FALLBACK_SETTINGS` entry, mirroring the backend default — a settings outage must render the full homepage, not an empty one.
- `src/app/(shop)/page.tsx`: the substantive change. Reads the config, builds the fetch set from the enabled sections, and renders them in the configured order. The fixed JSX becomes a map over the resolved list.
- The six section fetches become conditional, which means each section's data has to be addressable by its key rather than by position in a fixed `Promise.all` tuple.

**admin/**
- `src/lib/api/store-settings.ts`: the new type on the settings record and the update input, plus a mirrored `SECTION_REGISTRY` / `DEFAULT_HOME_CONFIG` — the admin read returns the row as-is, so it cannot otherwise distinguish "not configured" from "configured to the default".
- New `src/features/ui/home-sections/home-sections-page.tsx`.
- `src/routes/nav-config.ts` **and** `src/routes/app-router.tsx` — both, or the page does not exist; role gating mirrored by hand per the existing convention.
- A drag-reorder interaction, which the admin's 34 shadcn primitives do not currently include.

**Public API**: `GET /settings/public` and admin `GET /settings` gain one field. `PATCH /settings` accepts one more key. No removals, no changed shapes.
