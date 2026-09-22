## Context

See proposal.md — Why. What matters for the approach is the shape of what already exists.

`StoreSetting.homeConfig` is a JSON column holding an ordered array of `{ key, enabled }`. Three pieces of code govern it and all three are load-bearing here:

- `HOME_SECTION_KEYS` (`store-setting.constant.ts`) is simultaneously the closed key set, the default order and — mapped to `enabled: true` — the default configuration. Its comment records that a key is named in **five places** across the three repositories, and that adding one means touching all five.
- `homeConfigSchema` (`store-setting.validation.ts`, ~line 485) validates a save. The per-entry object is `.strict()`, so an unknown field is a hard rejection, not a silent drop.
- `reconcileHomeConfig` (`store-setting.service.ts`, ~line 155) runs on every read. It walks the stored array, drops unregistered keys, collapses duplicates to the first occurrence, **rebuilds each entry as `{ key, enabled }`**, and splices in any registry section the store has never saved. The storefront's homepage comment ("The list arrives complete and current… Nothing on this page repairs it — doing so would be a second, divergent copy of that rule") is a direct consequence of that function.

Hero artwork is separate and already merchant-owned: `Banner` rows keyed by a `BannerPlacement` enum whose `HERO_SLIDER` / `HERO_SIDE` / `HERO_PROMO` values exist specifically for the one hardcoded hero layout.

Two constraints frame every decision below. The platform is **single-tenant per client** — one deployment, one database, one settings row per client — so nothing here needs tenant scoping. And the server has **no unit tests**; its correctness checks are the `verify-*.ts` scripts under `scripts/`.

## Goals / Non-Goals

**Goals:**

- Make a section's layout a stored, validated, publicly served setting without a migration and without changing what any existing store renders.
- Put the rule in exactly one place — the server — so the storefront and the admin panel cannot come to different conclusions about a given store.
- Leave room for the next slices (product card, category grid) without a second schema change.

**Non-Goals:**

- Rendering. Which components exist for each layout, and what they look like, is `add-hero-section-variants-ui`.
- Upload guidance. That each layout implies different artwork shapes is real, but it is admin-facing and belongs to `add-hero-section-variants-admin`.
- Presets. A whole vertical expressed as one importable blob is the later slice this one feeds; nothing here assumes it.
- Per-layout content. No layout gets its own heading, caption or call-to-action copy. The variant selects an arrangement of artwork that already exists.

## Decisions

### 1. The layout lives on the `homeConfig` entry, not on `theme` and not in a new column

**Chosen:** `HomeSectionConfig` becomes `{ key, enabled, variant? }`.

The alternatives were a `theme.heroVariant` field and a dedicated column. Both separate a section's layout from the section itself, which breaks down the moment the second section gets variants: `theme` would accumulate `heroVariant`, `productCardVariant`, `categoryGridVariant` as a flat parallel list that has to be kept in step with `HOME_SECTION_KEYS` by hand, and the connection between "this section is off" and "this section's layout" would live in two columns that can disagree.

Keeping it on the entry also means it inherits everything `homeConfig` already has: one editor owns it, the partial-upsert story is unchanged, and the array-replaces-wholesale rule still holds because the array's order is still the data.

The cost is that `reconcileHomeConfig` becomes responsible for one more field — see Decision 4, which is where the real work is.

### 2. A per-key offering registry, not a hero-only field

**Chosen:** `HOME_SECTION_VARIANTS`, mapping a section key to a non-empty ordered tuple of layout names. A key absent from the map offers no choice.

A `heroVariant`-shaped field would have to be replaced outright when `PRODUCT_CARD` gets variants next quarter — a second schema change, a second Postman edit, a second admin form. A registry absorbs that as a data edit.

It also gives validation something exact to check. "Is this a known layout" is the weak question; the strong one is "does *this section* offer *this* layout", and only a per-key map can answer it. `SPLIT_THREE` on `BRAND_BAR` is as wrong as `PURPLE` on `HERO`, and a flat union would accept the first.

**First entry is the default**, rather than a separate `defaultVariant` field. One source, no way for the two to disagree, and the admin's picker renders the tuple in order with the first pre-selected.

### 3. A layout on a section that offers none is rejected, not ignored

Zod's `.strict()` already forces a decision here: the field has to be declared, so the only question is what a value means on a key with no offering.

**Chosen:** reject with a validation error.

Accepting and dropping it would store nothing while reporting success. The admin panel would then show the merchant a choice that saved cleanly and governs nothing — the exact failure mode the existing duplicate-key check was added to avoid ("a duplicate arriving through the API is a bug in the caller and is rejected rather than silently halved"). Since no UI can produce this, a request carrying one is a bug in a client, and the loud failure is the useful one.

Note the asymmetry with Decision 4, which is deliberate: **writes are strict, reads are forgiving.** A bad write is a caller that can be fixed; a bad read is a merchant's live storefront, and refusing to serve it would take down a shop over a stale string.

### 4. The variant is resolved on read, and the stored value is never rewritten

**Chosen:** `reconcileHomeConfig` emits a resolved `variant` for every section that offers one — stored value when it is still offered, default otherwise — and leaves the database as it found it.

This is the part most likely to be got wrong, and it fails silently. The function today rebuilds entries as `{ key, enabled }` from a `Map<HomeSectionKey, boolean>`. Add the field to the schema, add the picker to the admin, and a save will succeed, persist correctly, and then come back **without** the variant on the very next read — a setting that appears to work once and then forgets. So the `seen` map has to carry `{ enabled, variant }`, and the rebuild has to emit both.

Resolving on read rather than migrating keeps this additive: no column, no `prisma migrate`, no backfill, and a store that never opens the screen is served exactly the bytes it was served before. It also makes withdrawing a layout safe — a store sitting on a retired one falls back to the default and keeps rendering, rather than having its stored row rewritten underneath it.

Rejected: resolving in each client. That is a second copy of the rule in two repositories, and the homepage's own comment already states why the storefront does not repair this list. The single exception is the storefront's `FALLBACK_SETTINGS`, which exists precisely for the case where the server said nothing at all.

### 5. `DEFAULT_HOME_CONFIG` stays derived and does not name a variant

It is built as `HOME_SECTION_KEYS.map(key => ({ key, enabled: true }))`, and it stays that way. Writing `variant: "SPLIT_THREE"` into the `HERO` entry would create two representations of one state — absent and explicitly-default — that reconciliation would then have to keep equivalent forever. Absent already resolves correctly, and the response the merchant reads is resolved either way.

### 6. `BannerPlacement` is unchanged; layouts differ only in how they use the three slots

**Chosen:** the same three hero placements serve all four layouts. `SPLIT_THREE` uses slider + 2 side + 1 promo, `SPLIT_ONE` uses slider + 1 side, `FULL_SLIDER` uses the slider alone, `SLIDER_STACK` uses slider + 2 side + 1 promo in a row beneath it.

Per-layout placements (`HERO_STACK_TILE_1`, …) would make artwork a merchant uploaded belong to a layout rather than to the store, so switching layout would visibly lose it and switching back would not bring it back. It would also mean an enum value and a migration per layout — the opposite of what a preset system needs.

The consequence is stated as a requirement rather than left implicit: **switching layout never deletes a banner.** Slots a layout does not render go unread, and the rows stay exactly where they are. The admin change is responsible for telling a merchant that some of their artwork is currently unused; hiding that is how a merchant concludes their uploads were destroyed.

What does move is the meaning of "how many" and "what shape". Capacity and aspect ratio are per layout, which is why `hero-slots.ts` in the admin has to become a function of the selected variant rather than a constant. That is called out here because this decision is what creates that obligation, even though the work is in another repository.

### 7. Four layouts, chosen for coverage rather than count

`SPLIT_THREE` (default, current), `SPLIT_ONE`, `FULL_SLIDER`, `SLIDER_STACK`. The set spans the two axes that actually differ between verticals — how many promotions sit above the fold, and whether the largest element is contained or full width — rather than offering four rearrangements of the same density. A fifth is a data edit plus a component; nothing here caps the list.

## Risks / Trade-offs

- **`reconcileHomeConfig` drops the variant and the setting silently forgets itself.** → The single most likely defect in this change, and it passes every manual test that does not re-read after saving. `scripts/verify-hero-section-variants.ts` asserts the round trip explicitly, and Decision 4 records why.
- **`.strict()` rejects the admin's save** because the field was added to the registry and the reconciler but not the schema. → Loud rather than silent, and covered by the same verify script asserting that a valid save passes validation.
- **Registry drift across three repositories.** The five-places rule for `HOME_SECTION_KEYS` becomes six with the variant list, and nothing in the build catches a storefront that lacks a component for a layout the server offers. → The verify script asserts the server side; the storefront change is responsible for making a missing component fall back to the default rather than render nothing, so drift degrades to the old hero instead of a blank band.
- **Postman drift.** The collection is the contract of record for both clients, and `verify-postman-routes.ts` checks routes, not body fields — it cannot catch a missing `variant` in a documented payload. → Updating the collection is a task in this change, not a follow-up.
- **A merchant switches layout, loses sight of artwork, and re-uploads it.** → Not preventable server-side; it is why Decision 6 makes "kept, not deleted" a requirement and hands the admin change the job of surfacing unused slots.
- **Trade-off accepted:** resolution on every read costs a small amount of work on the hottest settings path. It is a lookup against an in-memory map inside a function that already walks the whole array, and it buys the guarantee that no client ever defaults the value.

## Migration Plan

No schema migration. `homeConfig` is an existing JSON column and the field is optional inside it.

Deploy order across the three repositories matters in one direction only:

1. **This change (server) ships first.** It is backward compatible on both sides — an old client never sends `variant` and gets a resolved one it ignores; an old storefront receives an extra field it does not read.
2. `add-hero-section-variants-ui` (storefront) second, so the layouts can be rendered before a merchant can pick one.
3. `add-hero-section-variants-admin` (admin) last. Shipping the picker before the storefront can render the choice would let a merchant select a layout that silently renders as the default.

Rollback is reverting this change alone: stored `variant` values become unrecognised fields inside a JSON column, `reconcileHomeConfig` ignores them exactly as it ignores any unknown entry shape, and every store returns to the default hero. Nothing has to be cleaned up, though a client that still sends `variant` would then be rejected by `.strict()` — which is why the admin ships last and rolls back first.
