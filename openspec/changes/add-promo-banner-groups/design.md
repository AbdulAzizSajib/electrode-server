## Context

See proposal.md — Why. The constraints that shape this design are all existing invariants of the homepage configuration, and each one assumes what this change breaks:

- `HOME_SECTION_KEYS` in `store-setting.constant.ts` is a compile-time tuple of twelve strings, mirrored by hand in `nextjs/src/types/store-settings.ts` and `admin/src/lib/api/store-settings.ts`. Its own doc comment warns that a key present in the backend but missing from the admin mirror is *silently deleted from the merchant's saved configuration by the next unrelated save*.
- `reconcileHomeConfig` dedupes on `key` via a `Map<HomeSectionKey, …>` — first occurrence wins — and drops anything not in the registry. Both behaviours are correct for fixed sections and fatal for repeated ones.
- `MID_BANNERS` renders via `nextjs/src/components/home/MidBanners.tsx`, which calls `getBannersByPlacement()` and takes `.MID` wholesale into a `sm:grid-cols-3`.
- The homepage builds `rendered: Record<HomeSectionKey, ReactNode>` and looks each section up **by key**, then renders `sections.map(...)` with `key={section.key}` as the React key.
- `resolveSectionVariant` resolves a section's layout from a per-key tuple at read time, never rewriting what is stored. That is the precedent this change follows for a group's layout.

## Goals / Non-Goals

**Goals:**

- One data model where a promo strip is a row, so the count of strips is merchant data rather than a compiled-in tuple.
- A homepage configuration that can carry repeated `MID_BANNERS` entries without weakening the dedupe rule for the other eleven keys.
- A migration under which an existing store's homepage is byte-identical in render terms after deploy.
- Failure modes that degrade to *rendering less*, never to a broken page: a deleted group, an unknown layout, a banner-count/layout mismatch all resolve to something renderable.

**Non-Goals:**

- Generalising this to *every* section being repeatable. Only `MID_BANNERS` becomes instanced; the other eleven stay single. Building the general case now would mean a migration of all twelve mirrors for a feature one section needs.
- Per-group scheduling. A group is shown or hidden via its homepage entry, and its banners keep their own `startsAt`/`endsAt`. A second scheduling layer would have two answers to "why is this not showing".
- Replacing `BannerPlacement.MID`. It stays as the marker for "this is promo artwork"; the group is an additional axis, not a replacement for placement.
- Per-group styling beyond tile count (background, heading, padding).

## Decisions

### Decision 1 — A group is a table, not a JSON array on `StoreSetting`

`PromoBannerGroup` is a real model with `id`, `name`, `layout`, `sortOrder`, timestamps, and `banners Banner[]`.

**Alternative considered:** storing groups as a JSON array inside `StoreSetting.homeConfig` or a new JSON column, with banner membership by id list. Rejected on the repo's own rule: *"Json columns are unconstrained by Postgres, so the Zod schemas are the only gate."* Banner membership is a relation — a banner id inside a JSON array has no foreign key, so deleting a banner would leave a dangling id that every reader has to defend against forever. A real column with `onDelete: SetNull` makes the detach behaviour the database's job rather than seven call sites'.

**Consequence:** `StoreSetting` stays a singleton with no new list on it, and the Storage/settings partial-PATCH discipline is untouched — this is a separate module with its own endpoints.

### Decision 2 — Banner membership is a nullable FK on `Banner`, not a join table

`Banner.promoBannerGroupId String?` with `onDelete: SetNull`.

A banner belongs to at most one group (spec: *"A banner belongs to at most one promo group"*), so a join table would model a cardinality that is not permitted and would need a uniqueness constraint to forbid it again. The nullable FK states the rule structurally.

`SetNull` rather than `Cascade` is what implements *"deleting a group does not delete its banners"* — a merchant who deletes a strip is removing an arrangement, not throwing away artwork they paid for. Detached banners surface in the admin's banner list as unassigned, which is a state they can already see and fix.

**Why placement is still required:** a group holds `MID` banners only. Validation refuses an assignment whose banner carries a hero/header/footer/sidebar/popup placement, because the hero placements are owned by the Home Slider manager with its own capacity rules (`hero-slots.ts`), and letting a group claim one would mean the same record edited from two surfaces with different rules.

### Decision 3 — `homeConfig` entries gain an optional `groupId`, and dedupe becomes key-aware

The stored shape becomes `{ key, enabled, variant?, groupId? }`. Reconciliation changes as follows:

- The dedupe map is keyed by `key` for the eleven fixed sections and by `` `${key}:${groupId}` `` for `MID_BANNERS`. First occurrence still wins within an identity, so two entries naming *the same* group collapse to one — matching the existing rule rather than carving an exception into it.
- A `MID_BANNERS` entry with no `groupId`, a non-string `groupId`, or a `groupId` naming a group that no longer exists is **dropped**, exactly as an unregistered key is today. The reasoning is identical: there is no component that can render it.
- Every group that exists but is named by no entry is **spliced in enabled**, at the registry position of `MID_BANNERS`, in the group's own `sortOrder`. This is the same splice `reconcileHomeConfig` already performs for a section added in a later release, and it is what makes creating a group in the Promo Banners manager enough to put it on the page.

**Alternative considered:** a synthetic key per group, e.g. `MID_BANNERS:<uuid>`, keeping the config entries string-keyed and the dedupe map untouched. Rejected because `HomeSectionKey` is a union type consumed by `Record<HomeSectionKey, ReactNode>` in the storefront and by `HOME_SECTION_REGISTRY` lookups in the admin; making it an unbounded string would erase the type safety that currently catches a mirror drift at compile time, in all three packages. A separate `groupId` field keeps `key` a closed union and puts the open-ended part in a field that is *typed as open-ended*.

**Consequence — this is the BREAKING part.** `reconcileHomeConfig` now needs the store's group list to reconcile against, so it takes a second argument and its callers must read groups first. `verify-` scripts and any direct caller change with it.

### Decision 4 — Layout is a per-group column resolved on read, mirroring `resolveSectionVariant`

`PromoBannerLayout` is a Prisma enum (`ONE | TWO | THREE`) on the group row, not a `variant` on the homeConfig entry.

It lives on the group because it is a property of *that strip*, and a strip's identity is the group. Putting it on the config entry would mean the same group rendering at different widths depending on which entry named it — and would make "delete the entry, re-add it" silently lose the layout.

Resolution follows the established rule exactly: **position 0 of the tuple is the default**, unrecognised values resolve to it at read time, and nothing rewrites what is stored. The default is `THREE` because three-across is what the storefront rendered before this change — the same reasoning that pins `SPLIT_THREE` and `GRID` at position 0 of their tuples. The tuple is declared once in `store-setting.constant.ts` as `PROMO_BANNER_LAYOUTS` and mirrored in the two frontends, carrying the same obligation as the registries beside it.

**Layout and banner count are deliberately independent.** A `THREE` group holding two banners renders two tiles. Refusing the save instead would mean a merchant cannot delete a banner without first changing the layout, and cannot change the layout without first adding banners — a deadlock over an arrangement that renders perfectly well. The admin *warns* on a mismatch; the API does not refuse it.

### Decision 5 — The storefront keys sections by instance, and `MidBanners` takes a group id

`(shop)/page.tsx` currently builds `Record<HomeSectionKey, ReactNode>` and renders `<Fragment key={section.key}>`. Both break on repeated keys: the record holds one element per key, and duplicate React keys inside a list are a correctness bug, not a warning.

So: the `rendered` map keeps holding the eleven fixed sections, and `MID_BANNERS` is built per entry — `<MidBanners groupId={section.groupId} />` — with the Fragment keyed by `` `${section.key}:${section.groupId ?? ""}` ``.

`MidBanners` takes `groupId` and reads its own group's banners and layout from the payload, then maps the layout to a grid class through a lookup object (`ONE → grid-cols-1`, `TWO → sm:grid-cols-2`, `THREE → sm:grid-cols-3`). **A lookup, not an interpolation** — `sm:grid-cols-${n}` is not a class Tailwind's scanner can see, so the styles would simply not be emitted.

The tile aspect ratio is currently `aspect-2/1`, chosen (per the component's own comment) because the tiles are a third of the content width. At one and two across the same ratio would produce a very tall band, so each layout carries its own ratio — roughly `6/1` for `ONE` and `3/1` for `TWO`, matching the merchant's reference artwork. This must be stated in the admin's upload guidance the way `hero-slots.ts` states the hero's, or merchants will export artwork for the wrong shape.

### Decision 6 — The storefront reads groups from the settings payload, not a new endpoint

The homepage already fetches store settings in its layout (a cached read) and banners via `getBannersByPlacement()`. Serving each group's name, layout and order inside the existing public settings payload — alongside `homeConfig`, which already names them — adds no round trip. Banner membership rides the existing `GET /banners` response as a `promoBannerGroupId` per banner, so `MidBanners` filters the already-fetched list rather than issuing a request per strip.

**Alternative considered:** `GET /promo-banner-groups/:id/banners` per strip. Rejected — three strips would mean three sequential requests on the critical path of the homepage, for data one existing response already carries.

The admin *does* get full CRUD endpoints under `/promo-banner-groups`, admin-gated, because it needs to create, rename, reorder and delete.

### Decision 7 — Migration backfills in SQL, in one transaction with the schema change

One migration does four things in order:

1. `CREATE TYPE "PromoBannerLayout"` and `CREATE TABLE "PromoBannerGroup"`.
2. `ALTER TABLE "Banner" ADD COLUMN "promoBannerGroupId"` + FK with `ON DELETE SET NULL`.
3. Insert one group named `Promo banners`, layout `THREE`, **only if at least one `MID` banner exists**, and set every `MID` banner's `promoBannerGroupId` to it. A store with no promo banners gets no group — spec: *"Store with no promotional banners"*.
4. Rewrite each `StoreSetting.homeConfig` JSON array in place, setting `groupId` on the existing `MID_BANNERS` entry to that group's id, preserving its position and its `enabled` flag.

Step 4 is what makes the upgrade invisible. Without it, the stored entry would carry no `groupId`, Decision 3 would drop it, and reconciliation would then splice a fresh enabled entry — which **loses a merchant's deliberate "promo section off"** and moves the strip to the registry's default position. Doing it in SQL rather than lazily on read is deliberate: a read-time repair would have to run on every settings read forever and would have no way to distinguish "legacy entry" from "entry whose group was deleted", which are the two cases that need opposite treatment.

**Reminder, per CLAUDE.md:** the generated migration will contain `DROP INDEX` for `Product_name_trgm_idx`, `Product_sku_trgm_idx` and `Brand_name_trgm_idx`. Delete those three lines and carry forward the NOTE block from the most recent migration.

### Decision 8 — Cache invalidation fires `banners` and `store-settings`

Group writes fire both tags. `banners` because a strip's contents changed; `store-settings` because the group's *existence, name, layout and order* are served in the settings payload and consumed by `homeConfig` reconciliation. Firing only `banners` would leave a renamed or newly-created group invisible for a full settings window — precisely the failure `add-storefront-cache-tags` was written to fix.

Both fire **after** the transaction resolves, never inside it, per the repo's standing rule.

## Risks / Trade-offs

**A mirror drifts and a merchant's config is silently rewritten.** → The highest-consequence risk in the change, and it is pre-existing: the admin's `HOME_SECTION_REGISTRY` filter writes its filtered list back on save. The new `groupId` field must be preserved by that filter, or the admin's first save after this ships strips `groupId` from every entry and every promo strip disappears. `verify-promo-banner-groups.ts` asserts a round-trip through the admin's write shape preserves `groupId`, and the admin's home-sections editor must be checked for field-dropping specifically.

**Backfill mis-detects the existing entry.** → A store whose `homeConfig` is null, non-array, or missing a `MID_BANNERS` entry has nothing to rewrite in step 4. That is correct and needs no repair: reconciliation splices an enabled entry for the group, which is the right answer for a store that never configured its homepage. The migration must therefore treat "no entry found" as success, not as a failure to backfill.

**`reconcileHomeConfig` now needs the group list, so it can no longer be pure over the stored value alone.** → Its signature changes to take the groups; callers that cannot supply them (if any) must pass an empty list, which drops every promo entry. Every call site is audited in tasks.md rather than defaulting the parameter — a silent default here would empty a merchant's promo strips.

**Layout/count mismatch renders an unbalanced strip.** → Accepted, per Decision 4. A `THREE` group with two banners leaves a gap. The admin warns inline; the storefront renders what exists. The alternative — refusing the save — creates the deadlock described above.

**Unbounded group count.** → No cap is enforced, per the spec. Each group is a small row and its banners ride an already-fetched response, so the cost of many groups is page length, which is the merchant's decision. If this proves a problem the cap belongs in validation, not in the schema.

## Migration Plan

1. Ship the backend: schema, migration (with the `DROP INDEX` lines removed), the new module, banner assignment, and the reconciler change. The public payload now carries groups; no client reads them yet.
2. Ship the storefront: `MidBanners` takes `groupId`, the homepage keys by instance. Prior to this, the migrated store renders its single carried-over group through the old path — which is why step 1's backfill must leave the config entry intact.
3. Ship the admin: the Promo Banners manager, the group picker on the banner form, and the Home Sections rows labelled per group.

**Rollback:** reverting the storefront and admin is safe — the backend's extra fields are additive and ignored by an older client, and the carried-over group's entry reads as a plain `MID_BANNERS` entry with an extra field. Reverting the *migration* is not safe once merchants have created a second group: those groups' banners would be detached with no entry naming them. Treat the migration as forward-only after the admin ships.

## Open Questions

- Whether the admin should offer a group-level heading rendered above the strip. None of the reference screenshots show one, so it is out of scope here; adding it later is a nullable column and a conditional `<h2>`, and needs no change to any decision above.
