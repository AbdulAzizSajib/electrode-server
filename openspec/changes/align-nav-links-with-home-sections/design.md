## Context

See proposal.md — Why. What matters here is that the mechanism already exists and this change extends it rather than inventing one.

`nextjs/src/lib/catalog-features.ts` already drops merchant-authored nav entries that lead somewhere the shop no longer offers: `filterNavForFeatures(items, catalogConfig)` removes a `/wishlist` link when `showWishlist` is off, and `Header.tsx:112` calls it before rendering — and before passing the result down to `MobileMenuDrawer`, which is why the two surfaces already agree without either of them knowing about the other. This change is the same idea with a second input.

Three facts shape the approach:

- **`Header` already receives the whole settings object** (`(shop)/layout.tsx:64`), so `homeConfig` is in hand at the call site. No new fetch, no prop-drilling, no context.
- **`MobileMenuDrawer` receives the already-filtered `mainNav`** from `Header` (`Header.tsx:750`). Filtering once, in `Header`, satisfies the "both surfaces agree" requirement structurally rather than by remembering to do it twice.
- **`homeConfig` arrives complete.** The backend reconciles a stored config against the registry on read, and `services/store-settings.ts` substitutes the full `FALLBACK_SETTINGS.homeConfig` when the payload is empty or missing. A section absent from the array is not a normal state.

## Goals / Non-Goals

**Goals:**

- Extend the existing nav-filtering pattern rather than adding a parallel one.
- Keep the storefront's decision derivable from data the page already holds, so it cannot fail separately from the settings read.
- Make the coupling visible in the admin on both screens, so a merchant never has to discover it by looking at their live site.

**Non-Goals:**

- Any server-side coupling between `mainNav` and `homeConfig`. The two columns stay independent; this is entirely a render-time rule plus admin reporting.
- Reconciling the header's hardcoded `/deals` "Today's Offers" control. See Decision 5.
- Footer links, the announcement bar, and any override mechanism. See proposal.md.

## Decisions

### Decision 1: Extend `catalog-features.ts`'s pattern, but as a separate module

A new `nextjs/src/lib/nav-sections.ts` exporting `filterNavForSections(items, homeConfig)`, and `Header` composes the two filters.

**Why not add it to `filterNavForFeatures`?** Because the two rules have genuinely different shapes and merging them would force the weaker one onto both:

- `catalogConfig` is read through **module scope** (`getCatalogFeatures()`) because its consumers include client components and server route files that cannot share a context. `homeConfig` has exactly one consumer — `Header` — which already has it as a prop. Adopting module scope for it would mean taking on the multi-tenancy caveat that module documents, to solve a problem this rule does not have.
- `isHrefOffered` **strips query and fragment before comparing** (`/wishlist?from=menu` is still the wishlist). This rule must do the opposite: `/products?sort=new` and `/products?sort=best` differ *only* by query string and map to different sections, while `/products` itself maps to none.

Sharing one function would mean one of those two behaviors silently applying where it is wrong. Two small modules, composed at the single call site, keep each rule's matching semantics its own.

**Composition order is irrelevant** — both are pure filters over the same list — so `Header` applies them in whichever order reads best, in one `useMemo` over `[settings.mainNav, settings.homeConfig, catalogConfig]`.

### Decision 2: Exact whole-string match, not path matching

The map is keyed on the complete stored target string, compared verbatim.

This is deliberately *stricter* than the neighbouring `isHrefOffered`, and the reason is that the query string carries the meaning here. Normalizing `/products?sort=new` to `/products` would collapse New Arrivals, Best Selling and a plain shop link into one indistinguishable target. There is no normalization that is safe for both rules, which is the concrete form of Decision 1's argument.

The cost is that `/blogs/` (trailing slash) and `/products?sort=new&page=1` are not governed and will keep rendering. That is the right failure direction: **failing to hide a link leaves the merchant exactly where they are today, while hiding a link the merchant wrote deliberately destroys work they can neither see nor undo.** Every ambiguous case resolves toward rendering.

**Alternative considered — prefix matching** (`/blogs/*` → `BLOG`): rejected on the same asymmetry. It would catch `/blogs/` but would also hide a link to a specific article the merchant deliberately featured, and `/products?...` prefixes are unusable regardless.

### Decision 3: The map lives beside the section registry, mirrored into the admin

The storefront's copy sits next to the `HomeSectionKey` type it references; the admin's copy sits in `src/lib/api/store-settings.ts` beside `HOME_SECTION_REGISTRY`, which it must agree with.

This inherits the existing mirroring obligation documented on `HOME_SECTION_KEYS` — and the existing hazard, one step removed. A drifted map is **not** as dangerous as a drifted section registry: the admin registry's danger is that a missing key is silently deleted from the merchant's saved config on the next save, whereas a drifted route map only makes a notice appear where no link is hidden, or fail to appear where one is. Wrong, visible, and non-destructive.

Both copies are keyed on values already fixed elsewhere: the targets are the `STOREFRONT_ROUTES` entries in `admin/src/features/ui/components/link-target-input.tsx`, and the section keys are `HOME_SECTION_KEYS`. **Adding a route to the picker does not govern it** — governing a new target means adding it to both maps deliberately, which is the intended friction.

### Decision 4: Parent-survival rule, and where it differs from the existing filter

`filterNavForFeatures` today keeps a parent whose children were all dropped, on the grounds that "its own destination is still a real one". That reasoning holds when the parent's target is ungoverned — but not when the parent's own target is itself governed and disabled, which the feature filter never has to consider because it drops such a parent outright at the top level.

So this filter drops a parent only when it has no surviving children **and** its own target is governed-and-disabled. A parent with an ungoverned target keeps rendering as a plain link, matching the existing behavior.

An item with an empty target and no surviving children is also dropped — it would otherwise render as a dropdown trigger that opens nothing.

### Decision 5: The hardcoded "Today's Offers" link is left alone, and that is a known inconsistency

`Header.tsx:729` renders a fixed `/deals` link that is not part of `mainNav`. Under this change, a merchant who disables `DEAL_OF_WEEK` sees their *configured* `/deals` link disappear while this one stays.

Left alone on purpose. It is chrome, not configuration — the merchant never authored it and cannot edit it, so hiding it would be the storefront withdrawing a feature rather than honoring a merchant's decision. Withdrawing it would also need its own answer to "what does the header's right-hand slot look like when it is gone", which is a layout question this change has no mandate to open.

It is named explicitly in the spec so that the inconsistency is recorded rather than discovered. If it turns out to confuse merchants, the follow-up is to make that link configurable, not to special-case it here.

### Decision 6: The admin reads the coupling from data both editors already load

Both editors call `useStoreSettings()`, which returns the entire settings row — so Header Links already has `homeConfig` and Home Sections already has `mainNav`. The notices are derived from the loaded query, with no new request and no new endpoint.

Two details follow from the editors' existing conventions:

- **Header Links reads the *saved* `homeConfig`, not a draft** — it does not own that field and must not include it in its PATCH. This matches how that page already treats `contactPhone`/`contactEmail`: "within this page they are read-only fact". Partial-PATCH disjointness is preserved exactly; neither editor's saved key set changes.
- **Home Sections computes its notice against its own live draft**, so toggling a section off updates the notice immediately, before saving. The header-links notice is the reverse case — it reflects what is saved and live, which is what "hidden on your site" claims.

### Decision 7: No verify script; storefront unit tests instead

There is no server-side behavior to verify, so `server/scripts/verify-*.ts` is the wrong instrument. The filter is a pure function over two inputs and belongs in `nextjs`'s vitest suite, alongside the existing `chrome-services.test.ts` that already asserts `homeConfig` invariants.

## Risks / Trade-offs

**A merchant intends a `/blogs` link to survive its section being off** → No override exists (proposal.md). The escape hatch is real but indirect: point the link at an ungoverned target. Accepted because a per-link override reintroduces exactly the "what the admin shows is not what the site does" problem this change exists to remove.

**The two route maps drift** → Non-destructive when it happens (Decision 3), and both are small and adjacent to the constants they derive from. A unit test asserting every mapped section key exists in the section registry catches the more likely half.

**Exact matching under-catches** → Stated as the deliberate failure direction (Decision 2). The admin notices are what make it observable: a merchant who expected a link to vanish and sees no notice on that row learns that the target is not governed, rather than concluding the feature is broken.

**A future section's route is added to the picker but not to the map** → Silently ungoverned, no notice, current behavior. Covered by the task to document the obligation at both map sites, in the same terms `HOME_SECTION_KEYS` already uses.

**`homeConfig` arrives empty from a degraded settings read** → Cannot hide anything: the storefront service substitutes the complete fallback, in which every section is enabled. The rule fails toward rendering every link, which is the pre-change behavior.

## Migration Plan

No data migration, no schema change, no API change. Ship storefront and admin independently in either order:

- Storefront first: links begin hiding, and the admin has not yet explained why. The Home Sections screen is where the merchant made the change, so the effect is at least attributable.
- Admin first: notices appear describing a suppression that is not yet happening. Strictly worse — the notice would be untrue for a window.

**Prefer shipping the storefront first.** Rollback is a revert of either side; nothing stored needs repair, because nothing stored changed.

## Open Questions

None. The matching strategy, scope, override policy and surface set were settled before this document (see proposal.md — What Changes).
