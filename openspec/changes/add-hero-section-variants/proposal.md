## Why

The homepage hero has exactly one layout, welded into `frontend/src/components/home/Hero.tsx`: a rotating slider on the left, two square tiles at the top right, one wide tile beneath them. A merchant can change the artwork in those three slots and nothing else. The arrangement itself — how many panels, what shape they are, whether there is a carousel at all — is a developer decision made once, for every store this platform will ever run.

That was tolerable while the platform served one electronics retailer. It is not tolerable now that the same codebase has to dress as a gadget shop, a handbag shop and a cosmetics shop. A gadget shop wants a dense hero that fits four promotions above the fold; a handbag shop wants one large editorial image with nothing competing against it. Today the only way to serve both is to fork the storefront, which means every checkout fix has to be applied twice.

So the hero's **layout** becomes a merchant setting, the way its **artwork** already is. This is the first of several sections to get this treatment — product cards and the category grid follow — and it is deliberately first, because the hero is where the verticals differ most and the first thing a prospective client looks at.

This change is the **server half**: it defines the closed set of hero layouts, carries a store's choice on the settings record, and serves it in the public payload. The storefront half (`add-hero-section-variants-ui` in `frontend/`) and the admin half (`add-hero-section-variants-admin` in `admin/`) are separate changes in their own repositories and both depend on this one.

## What Changes

- A new constant `HOME_SECTION_VARIANTS` maps a home-page section key to the closed, ordered list of layouts it offers, **first entry being its default**. `HERO` is the only key with an entry today; a key absent from the map offers no choice and rejects any attempt to set one.
- `HERO` offers four layouts:
  - `SPLIT_THREE` — slider on the left, two square tiles and one wide tile on the right. **The current layout, and the default**, so no existing store changes.
  - `SPLIT_ONE` — slider on the left, one large square tile on the right.
  - `FULL_SLIDER` — a single wide slider, no tiles.
  - `SLIDER_STACK` — a full-width slider with a row of three tiles beneath it.
- `HomeSectionConfig` gains an **optional** `variant`. Optional rather than required is the whole compatibility story: every stored `homeConfig` in every existing install predates this field, and absent has to keep meaning "the layout you already had".
- `homeConfigSchema` — the entry object is `.strict()`, so the field has to be added there explicitly or the API rejects every save the new admin screen makes. A `variant` is validated against the offering registry **for its own key**: an unknown layout is rejected, and a layout set on a section that offers none is rejected rather than quietly stored.
- `reconcileHomeConfig` resolves the variant on read, exactly as it already resolves the key list. **This is the load-bearing part**: that function currently rebuilds each entry as `{ key, enabled }` and would otherwise discard a stored variant on the way out, so a merchant's choice would save and then vanish on the next read. After this change every `HERO` entry in the public payload carries a resolved variant — a stored one when it is still offered, the default when it is absent, unrecognised, or left over from a layout since withdrawn.
- **Because the server resolves it, no client ever defaults it.** The storefront and the admin render the variant they are given. The one exception is the storefront's `FALLBACK_SETTINGS`, which stands in when the settings API cannot be reached at all and therefore has to carry the default itself — that is the storefront change's concern, not this one.
- **Banners are untouched.** `BannerPlacement` keeps its three hero values (`HERO_SLIDER`, `HERO_SIDE`, `HERO_PROMO`) and gains none. Each layout uses a different subset of those three at different shapes, but that is a rendering fact, and encoding it in the database would make artwork a merchant has already uploaded depend on a setting they are about to change.
- Consequently, **switching layout never deletes a banner**. A store on `FULL_SLIDER` still has its side tiles on file; they stop being rendered, and come back untouched when the merchant picks a layout that uses them. The doc comments on `BannerPlacement`, which currently describe the one hardcoded layout as though it were the only one, are corrected to say which layouts use each slot.
- `postman/Ecom.postman_collection.json` documents `variant` on the `homeConfig` entries of `PATCH /settings` and of the public settings read, with the four `HERO` values named.
- A verification script covers the reconciliation rules, since the server has no unit tests: absent resolves to the default, unknown resolves to the default, a valid choice survives a round trip, and one set on a non-`HERO` key is rejected.
- **No migration.** `homeConfig` is an existing JSON column and this adds an optional field inside it. No column, no backfill, no `prisma migrate` step.

Stated because its absence is deliberate: **no free-form layout.** The variant is a closed enum, not a template name or a JSON layout description. A merchant picks one of four arrangements the storefront has components for; they cannot describe a fifth. A layout no component renders is a blank hero, and a merchant cannot tell that apart from a broken site.

Also deliberate: **this is a per-install setting, not a per-tenant one.** The platform is single-tenant per client — each client gets their own deployment, their own database and their own domain — so there is exactly one store per settings row and the variant needs no scoping.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `api/site-settings`: extends the home-page section requirement so a section may also carry a **layout choice** from a closed set the server publishes, with a defined default, a defined resolution for a value that is absent or no longer offered, and a rule that a layout set on a section offering none is rejected.

## Impact

- `src/app/module/store-setting/store-setting.constant.ts` — `HOME_SECTION_VARIANTS` and the `HERO` layout union; `HomeSectionConfig` gains optional `variant`. `DEFAULT_HOME_CONFIG` is derived from `HOME_SECTION_KEYS` and stays derived: it does **not** spell out a variant, because absent already resolves to the default and two representations of one state is exactly what reconciliation exists to avoid.
- `src/app/module/store-setting/store-setting.validation.ts` — `homeConfigSchema` (around line 485): `variant` added to the `.strict()` object, plus a per-entry check against the offering registry. The existing duplicate-key check is untouched.
- `src/app/module/store-setting/store-setting.service.ts` — `reconcileHomeConfig` (around line 155): its `seen` map has to carry the variant alongside `enabled`, and the rebuild has to emit it. Nothing else in the public projection changes.
- `prisma/schema/enums.prisma` (around line 277) — comments only, on `BannerPlacement`'s three `HERO_*` values.
- `postman/Ecom.postman_collection.json` — the settings requests; verified with `npx tsx scripts/verify-postman-routes.ts`.
- `scripts/verify-hero-section-variants.ts` — new, following the existing `verify-*.ts` convention. Static, like `verify-postman-routes.ts`: it exercises the validation schema and the reconcile function directly and needs no database.
- **Downstream, in other repositories:** `frontend/` must map each layout to a component and mirror the registry in `FALLBACK_SETTINGS`; `admin/` must offer the picker and make its hero upload guidance a function of the chosen layout. Neither is in scope here.
