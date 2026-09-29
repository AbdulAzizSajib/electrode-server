## Why

A campaign page today renders its sections in an order welded into
`LandingPageView.tsx`: hero, offer, highlights, CTA, why-us, body, usage ideas,
CTA, quotes, FAQ, CTA. A merchant can decide *whether* a section appears — by
leaving its list empty — but never *where* it appears, and never what it is
called. The home page has had exactly this control since `add-home-sections`:
**UI → Home sections** lists the blocks the page is built from, drags to
reorder, and switches one off without deleting what it shows.

The mismatch matters more on a campaign than on the home page. A landing page is
one visitor, one ad, one decision, and which argument comes first is the
merchant's core lever — a shopper sold on price wants the offer block early,
one who needs reassurance wants reviews before the form. Today changing that
order is a code edit, so in practice it never changes at all.

The second half is the sections the merchant does not have. The eleven blocks
are a fixed vocabulary, and a campaign that needs a comparison table, a
guarantee panel, or a delivery-timeline strip has nowhere to put it. Merchants
work around this by pouring everything into `bodyHtml`, which is a single
unstructured blob that cannot be reordered, cannot be switched off, and carries
none of the page's theming.

## What Changes

- **A landing page stores its own section order.** A new `sectionConfig` Json
  column on `LandingPage` holds an ordered array of entries, each naming a
  section and whether it is enabled. Order is the data — the array is never
  sorted on the way to or from the API.
- **Sections can be switched off without being emptied.** Turning a section off
  hides it and leaves its content untouched, so turning it back on restores
  exactly what was there. This is a real behaviour change: today the only way to
  hide a section is to delete its content.
- **Merchants can add custom sections.** A custom section carries its own
  heading, body text and layout choice, and is stored as a normal entry in the
  same ordered array. A page may hold several, each with its own id.
- **A new admin page, UI → Landing sections**, built to the pattern
  `home-sections-page.tsx` established: a reorderable list, a switch per
  section, and an editor for the custom ones.
- **The storefront renders from the stored order** rather than from the fixed
  JSX sequence, falling back to the current hardcoded order for any page that
  has no `sectionConfig` — which is every page that exists today.
- **Band surfaces are derived, not stored.** The alternation that
  `LandingPageView` decides inline today is computed from the resolved order at
  render time, so a reordered page still alternates rather than rendering three
  identical surfaces in a row.

Not in scope, and deliberately: no per-section theming (the page's theme tokens
already cover it), no A/B testing or variant scheduling, and no reordering of
the fields *inside* the order form.

## Capabilities

### New Capabilities

- `storefront-cms/landing-page-sections`: which sections a campaign page is
  built from, in what order, which are switched off, and the merchant-authored
  custom sections among them. Covers the stored `sectionConfig` contract, the
  validation that guards it, the resolution of a stored order against the
  section registry, and the fallback for a page that has none.

- `storefront-cms/landing-pages`: the campaign page's content and band
  requirements, carrying the two that this change alters — a section is omitted
  when switched off as well as when empty, and the sections render in the
  merchant's stored order with the default order as the fallback.

  **Written as ADDED, not MODIFIED, deliberately.** This capability has no spec
  under `openspec/specs/` yet: it exists only in the deltas of earlier landing
  page changes, none of which has been archived. A MODIFIED delta against a
  target spec that does not exist is refused at archive time, so the two
  requirements are carried here in full — including the parts this change does
  not alter — and whichever change archives first establishes the spec.

### Modified Capabilities

None. See the note above: the landing page capability that this change alters
has no archived spec to modify.

## Impact

**Backend (`server/`)**
- `prisma/schema/LandingPage.prisma` — new `sectionConfig Json?` column, plus the
  `///` comment documenting its shape alongside the existing Json columns.
- One migration. **Remember the trigram-index rule**: open the generated SQL,
  delete the three `DROP INDEX` lines, and carry the NOTE block forward.
- `landing-page.validation.ts` — the Zod schema for `sectionConfig`. Json columns
  are unconstrained by Postgres, so this schema is the only gate.
- `landing-page.constant.ts` — the section registry and the default order.
- `landing-page.service.ts` — persists `sectionConfig`; fires the existing
  `landing-pages` revalidate tag on every mutating path.
- `landing-page.interface.ts` — payload and result types.

**Admin (`admin/`)**
- New `src/features/ui/landing-sections/` built on `useSettingsDraft`,
  `useUnsavedChangesGuard` and `ReorderableList` — the same scaffolding
  `home-sections-page.tsx` uses.
- Registered in **both** `src/routes/nav-config.ts` and
  `src/routes/app-router.tsx`; the two are kept in sync by hand.
- `src/lib/api/landing-pages.ts` — the mirrored registry and limit constants,
  which carry the standing obligation to be kept in step with `server/`.

**Storefront (`nextjs/`)**
- `LandingPageView.tsx` — renders from the resolved order instead of the fixed
  JSX sequence. This is the file the change most alters, and its header comment
  states the current ordering as deliberate; that comment must be updated to
  describe what now decides the order.
- `LandingBand.tsx` — surface becomes a resolved input rather than a per-call
  literal.
- `src/types/landing-page.ts` and `src/services/landing-page.ts` — the new field
  and its mapper.
- A new custom-section renderer, sanitised through `lib/sanitize-html.ts` like
  every other merchant-authored HTML path.

**Risk**
- Every existing campaign page has no `sectionConfig`. The fallback to the
  current hardcoded order is what keeps those pages rendering identically, and
  it is the single most important thing for the verify script to pin.
- A stored order can name a section the code no longer has, or omit one that was
  added after it was saved. Resolution against the registry must tolerate both
  rather than dropping content or crashing the page.
