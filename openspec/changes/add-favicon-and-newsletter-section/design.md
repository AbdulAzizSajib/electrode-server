## Context

See proposal.md — Why.

Two facts about the existing code shape everything below.

**The settings row already has a grammar for this.** `StoreSetting` carries `logoUrl` and `footerLogoUrl` as plain nullable `String?` columns, validated by `z.url().max(500)`, written through the partial upsert in `updateStoreSetting`, and opted into the public payload one line at a time. A favicon is the same kind of fact as a logo, so it gets the same treatment and nothing new is invented for it.

**`homeConfig` was built to absorb a new section without a migration.** `reconcileHomeConfig` (store-setting.service.ts) already drops unrecognised keys, collapses duplicates, and — the load-bearing part — splices any registry section a stored list is missing into its registry-relative position, enabled. Its doc-comment states the reason plainly: *without it, a section added in a later release would never render for any shop that had already saved a configuration*. This change is the first one to exercise that path in anger. If the design is right, adding `NEWSLETTER` is a one-line edit to `HOME_SECTION_KEYS` and everything else follows.

The constraint that makes this a cross-repo change rather than a local one: `HOME_SECTION_KEYS` is mirrored by hand in two places outside this repository — `frontend/src/services/store-settings.ts` (`FALLBACK_SETTINGS.homeConfig`) and `admin/src/lib/api/store-settings.ts` (`HOME_SECTION_REGISTRY`). Neither mirror can be updated from here.

## Goals / Non-Goals

**Goals:**

- A favicon address that reaches the storefront through the settings payload it already fetches, with no second request and no second cache.
- `NEWSLETTER` in the home-section registry, arriving in every already-saved configuration through the existing reconciliation rather than through a data migration.
- Both additive and both invisible on deploy: a server running this change with the old admin panel and the old storefront must behave exactly as it does today.

**Non-Goals:**

- Validating that the favicon URL points at an image, is square, or resolves at all. The server does not fetch merchant-supplied URLs, and it does not start here.
- Storing the favicon as a file. It is an address, like both logos.
- Any change to the `newsletter` column, its schema, or its public projection. What moves is the decision about where the block renders, which lives in `homeConfig`.
- A subscriber capture endpoint. Stated as a non-goal in the proposal and repeated here because it is the obvious next question.

## Decisions

### 1. `faviconUrl` is a column on `StoreSetting`, not a key inside `seoConfig` or `theme`

A favicon is brand artwork. It sits beside `logoUrl` and `footerLogoUrl` as a scalar column for the same reasons those are scalars: it is a single address with no internal structure, it needs no per-key merge on read, and a `z.url()` on a column is a stronger gate than a key inside a JSON blob that Postgres does not constrain.

*Alternative considered — inside `seoConfig`.* The favicon is emitted in the document head beside the meta tags, so the SEO blob is a defensible home. Rejected on two counts: `seoConfig` is read through `mergeSeoConfig`, a deep per-key merge built for nested defaults, and a flat string gains nothing from it; and the merchant-facing home for this setting is Site Setting → Branding, next to the logos, which is where the admin change puts it. Splitting the storage from the screen that owns it is how fields get lost.

*Alternative considered — inside `theme`.* `theme` is colours, widths and fonts — values interpolated into an inline style attribute. A URL in that blob would be the only member that is not, and `themeSchema`'s strict-hex posture exists precisely because its values reach a style attribute. Keep it out.

### 2. Null default, no backfill, and null is a real state

`faviconUrl` is nullable and `DEFAULT_PUBLIC_SETTINGS.faviconUrl` is `null`, following `logoUrl` exactly — not an empty string, and not the path of the icon the storefront currently ships.

Pinning the shipped path here would make "the merchant has not chosen an icon" indistinguishable from "the merchant chose the stock icon", which is the same mistake `footerLogoUrl` deliberately avoids by not defaulting to a copy of `logoUrl`. It would also hardcode a storefront asset path into the API, so moving that file in the storefront repository would break every store at once.

Null therefore means *nothing chosen*, and resolving that to a visible icon is the storefront's job — it owns the fallback because it owns the asset.

**Amended during apply: the field is `.nullable()`, unlike the two logo URLs it otherwise copies.** Writing it as `z.url().optional()` — the logo pattern — was wrong, and verifying against a running server is what caught it. Under a partial upsert an omitted key means "leave unchanged", so with `.optional()` alone there is no way to express *remove this*: `""` is refused by `z.url()`, `null` is refused by `.optional()`, and omitting the key preserves what is stored. A merchant could replace a favicon forever and never take one down.

The precedent is `freeShippingThreshold`, nullable for exactly this reason and documented as such: three meaningful states, not two, where the third is "withdraw the value".

`logoUrl` and `footerLogoUrl` have this bug **today** and are deliberately left alone — the admin's Clear button for both empties the form field and then omits the key (`site-settings-page.tsx:330-331`), so the artwork is never removed. Fixing that is its own change; see tasks.md section 7.

### 3. `NEWSLETTER` goes last in `HOME_SECTION_KEYS`, and that is a merchant-visible decision

Registry order is the default order and the pre-configuration order for every store that never opens the screen. Last — after `BLOG` — puts the newsletter immediately above the footer, which is exactly where it renders today. A merchant who never touches the setting sees the block move from inside the footer to just above it, which is the smallest visible change available.

*Alternative considered — mid-page, above `TESTIMONIALS`.* More prominent, and arguably better for signups. Rejected because it is a merchandising opinion this change is not entitled to make on behalf of every existing store, and because the merchant can now drag it there in three seconds. Defaults should preserve; the screen is for changing.

### 4. Adding the key is the whole change; `reconcileHomeConfig` is not touched

Appending `"NEWSLETTER"` to `HOME_SECTION_KEYS` gives, for free: the closed set that `homeConfigSchema` validates against, the default order, `DEFAULT_HOME_CONFIG` (which is derived from the array), and — through reconciliation on read — the splice into every already-saved configuration at the registry-relative position, enabled.

This is deliberately *not* a backfill. A migration writing `NEWSLETTER` into every stored `homeConfig` would produce the same result once and then leave the next section addition needing another migration. The doc-comment on the column already commits to reconciliation as the mechanism; honouring it here is what proves it works.

The one thing to confirm during apply rather than assume: that a stored list ending at `BLOG` reconciles to one ending `BLOG, NEWSLETTER` and not `NEWSLETTER, BLOG`. The splice is registry-relative, and `NEWSLETTER` is the last registry entry, so it lands last — but that is a claim to verify against the live read, not to take on faith.

### 5. Key naming: `NEWSLETTER`, permanent from the moment it ships

`HOME_SECTION_KEYS` carries a standing rule — *a key is permanent once released*, because stored merchant configurations name sections by these strings and renaming one silently discards every merchant's placement of that section. `NEWSLETTER` is chosen over `NEWSLETTER_SIGNUP` or `SUBSCRIBE` for brevity and because it matches the `newsletter` column it draws its copy from. The merchant-facing label ("Newsletter signup") lives in the admin's registry and can be reworded freely.

### 6. The public projection gets one line, and the allow-list stays an allow-list

`faviconUrl: merge(stored?.faviconUrl, DEFAULT_PUBLIC_SETTINGS.faviconUrl)` in `getPublicStoreSetting`, opted in explicitly like every other public field. `merge` is correct here — unlike `catalogConfig`, this is a scalar, so there is no per-key repair to do and no future key to lose.

Nothing else is added. A column added to `StoreSetting` later stays private until someone writes its line, which is the property this allow-list exists to preserve.

### 7. Verification extends `verify-site-settings.ts` rather than introducing a test runner

The server has no unit test framework; its correctness checks are the `verify-*` tsx scripts, and `add-catalog-display-settings` set the precedent of extending the existing site-settings script rather than adding a suite. Two checks, both against a live database: the favicon round-trips on the public and admin reads, and a `homeConfig` stored without `NEWSLETTER` reads back with it, enabled, in last position.

## Risks / Trade-offs

**A merchant pastes a URL that is valid but is not an image (or 404s).** → The server does not fetch merchant URLs and will not start doing so for this. The failure is visible and local: the browser tab shows its default icon. The admin change mitigates it where it can be mitigated — the upload button is the primary path and the field previews whatever is set.

**A merchant pastes an `http://` URL on an `https://` storefront.** → The browser blocks it as mixed content and the tab falls back to the default icon, with no error anywhere in this stack. Not gated here, because `logoUrl` is not gated either and a special case on one of the three would be the inconsistency. The admin's helper text is the right place to steer people to the upload button.

**A cross-origin favicon costs one extra DNS lookup and connection in the document head.** → Accepted. It is one small image on a host (Cloudinary) the storefront already loads every product image from, so the connection is warm by the time anything else needs it.

**The two hand-maintained mirrors of `HOME_SECTION_KEYS` drift.** → This is the real risk in the change and it cannot be closed from this repository. Concretely: if the admin's `HOME_SECTION_REGISTRY` lacks `NEWSLETTER`, the admin page treats it as unrecognised and drops it on the next save, silently deleting the merchant's choice; if the storefront's `FALLBACK_SETTINGS.homeConfig` lacks it, a settings outage renders the page without the newsletter. Mitigation is sequencing, not code — see Migration Plan — plus the existing doc-comment on `HOME_SECTION_KEYS` naming both mirrors, which the apply step must keep accurate.

**Ordering ambiguity for a store that had reordered its sections.** → Reconciliation splices at the registry-relative position, which for a last-place key means "at the end" regardless of how the merchant shuffled the rest. That is the intended answer, and Decision 4 makes verifying it an explicit task rather than an assumption.

## Migration Plan

1. **Ship this change first.** Both halves are additive and neither is observable with today's clients: an old admin panel never sends `faviconUrl` and never sees `NEWSLETTER` (it drops unrecognised keys from the list it renders, but only writes on save); an old storefront ignores `faviconUrl` and renders sections it recognises, so an unrecognised `NEWSLETTER` in the list renders nothing while the footer keeps its newsletter exactly as before. The site is correct at every point in between.
2. **Then the storefront** (`add-favicon-and-newsletter-section-ui`): emit the favicon, render the `NEWSLETTER` section, remove the block from the footer. Until this ships the section is in the list and renders nothing, which is invisible.
3. **Then the admin** (`add-favicon-and-newsletter-section-admin`): the favicon field, and the newsletter row plus its copy fields on Home Sections. Ordering between steps 2 and 3 is free — neither depends on the other, only on step 1.

**Rollback.** Reverting this change leaves the `faviconUrl` column in place holding data nothing reads, and removes `NEWSLETTER` from the registry — at which point reconciliation drops it from every stored configuration on the next read and the storefront stops rendering it. Harmless *only if the storefront's footer still has its newsletter*, i.e. only before step 2. After step 2, a rollback of this change removes the newsletter from the site entirely until it is rolled forward; the merchant's stored wording is untouched throughout, because nothing in this change writes to the `newsletter` column.

The migration itself is one additive nullable column and is reversible with no data loss.

**Watch for pg_trgm drift.** `prisma migrate dev --create-only` has repeatedly emitted spurious `DROP INDEX` statements for `Product_name_trgm_idx`, `Product_sku_trgm_idx` and `Brand_name_trgm_idx` — raw-SQL GIN indexes that are not modelled in the schema, so Prisma reads them as drift on every generated migration. Applying them would silently degrade product search to a sequential scan. Strip them by hand and confirm all three still exist afterwards, following the note in `20260907013258_add_order_item_unit_cost/migration.sql`.
