## Context

See proposal.md — Why.

The constraints that shape this design are all existing ones:

- **The order is in JSX today.** `LandingPageView.tsx` renders eleven bands in a
  literal sequence, each with a hardcoded `surface`. There is no data anywhere
  that says what order a campaign's sections are in.
- **`homeConfig` already solved the same problem** for the home page:
  an ordered `{ key, enabled, ... }[]` on `StoreSetting`, a registry constant, a
  Zod schema that is the only gate, and an admin page built on
  `useSettingsDraft` + `ReorderableList`. Its conventions — order is the data,
  a key that may repeat is named rather than inferred, unknown keys rejected at
  validation — are the ones this change should follow rather than reinvent.
- **Json columns are unconstrained by Postgres.** The Zod schema is the only
  thing standing between a request and the column, which is why validation is a
  requirement in the spec rather than an implementation note.
- **Every existing campaign page has no stored order.** Whatever this change
  does, those pages must keep rendering exactly as they do now, with no
  migration and no merchant action.
- **`LandingBand` already takes `surface` and `width` as props**, so the render
  path is most of the way to being driven by data rather than by literals.

## Goals / Non-Goals

**Goals:**

- One stored, ordered list per landing page that decides what renders and in
  what order.
- Rendering that is a fold over that list, so adding a section type is a
  registry entry plus a renderer rather than an edit to a fixed sequence.
- A resolution step that tolerates drift in both directions — stored keys the
  code dropped, and code sections the stored order predates.
- Byte-identical output for a page with no stored order.

**Non-Goals:**

- Reordering the fields *inside* the order form. That form's order was settled
  separately and is not part of this list.
- Per-section theme overrides. The page's theme tokens already cover colour, and
  a per-section override would defeat the single point of control that
  `add-landing-page-theme-tokens` established.
- A general page builder. The built-in sections keep their dedicated editors and
  their typed content; custom sections are heading + body + layout, and
  deliberately no more.
- Scheduling, variants or A/B tests on sections.

## Decisions

### D1. One `sectionConfig` column on `LandingPage`, not a join table

A nullable `sectionConfig Json?` holding the ordered array, alongside the Json
columns the model already carries for `highlights`, `faqs`, `quotes` and the
rest.

*Why:* the list is small, bounded, always read whole, and never queried across
pages — the exact shape `homeConfig` already uses for the same job. A join table
would add a migration, a set of ordering columns, and a read that can return
rows out of order, in exchange for query abilities nothing needs.

*Why nullable:* `NULL` is the load-bearing value. It means "this page has never
been through the section editor", which is what the default-order fallback keys
off. A `NOT NULL DEFAULT '[]'` would make "no order" indistinguishable from "all
sections deliberately removed", and every existing page would render blank.

*Alternative considered:* storing the order as an array of keys and keeping
`enabled` elsewhere. Rejected — two sources for one decision, and they can
disagree about a section that is in one and not the other.

### D2. Content stays where it is; only the ordering moves

`highlights`, `faqs`, `quotes`, `whyUs`, `usageIdeas`, `trustBadges` and
`bodyHtml` keep their own columns and their own editors. `sectionConfig` holds
only `{ key, enabled }` for built-in sections — never their content.

*Why:* it keeps this change additive. The existing editors, validation schemas
and storefront components are untouched, so the blast radius is the ordering and
nothing else. Folding content into `sectionConfig` would mean rewriting every
one of those and migrating live data, for no behavioural gain.

*Consequence, stated because it is the obvious objection:* a section's content
and its enabled flag now live in two columns and are written by two editors. The
spec's "disabling is not emptying" requirement is precisely what makes that
correct rather than redundant — they answer different questions.

### D3. Custom sections are entries in the same array, carrying their own content

A custom entry is `{ key: "CUSTOM", id, enabled, heading, body, layout }` in the
same ordered list.

*Why one list and not two:* order is the whole point, and a custom section must
be placeable *between* built-in ones. Two lists would need a merge rule to
produce one sequence, and that rule would be a second place where order is
decided.

*Why custom content is inline while built-in content is not:* a built-in
section's content already has a column, a schema and an editor; a custom
section's has none of those and would otherwise need a column per field for a
type the merchant invents at runtime.

**`CUSTOM` is the one key that may repeat**, exactly as `MID_BANNERS` is in
`homeConfig`. This is named in the constants rather than left implicit, because
every place that matches entries by `key` alone would otherwise collapse every
custom section into one. Matching is on `key` + `id`, never on `key` alone —
the same rule, and the same failure, as the promo strips.

`id` is generated by the admin when the section is created and is stable across
saves. Position is not an identity: reordering would otherwise rewrite which
section is which.

### D4. Resolution happens on the storefront, against the registry

A pure function takes the stored order plus the registry and returns the
sections to render, in order. It drops entries whose key is unknown, appends
registry sections the stored order does not mention at their default position,
and returns the default order outright when the stored value is absent or
unreadable.

*Why a pure function, separately testable:* this is the part that must not fail.
It runs on every campaign page view, its inputs drift over time by design, and
its failure modes are a blank campaign page or a lost section — both of which
cost ad money silently. It takes data and returns data, so it can be pinned by a
verify script without a browser or a database.

*Why append rather than ignore unmentioned sections:* a section added to the code
after a page was last saved would otherwise be permanently invisible on that
page, with no indication why, and the merchant's only remedy would be to
re-save a page they have no reason to touch.

*Why drop rather than error on unknown keys:* the alternative is a campaign page
that 500s because a section type was retired. Dropping degrades one section;
erroring costs the whole page, and this is the one page in the system where a
failed render is money already spent.

### D5. Surfaces are computed from position, not stored

`LandingBand`'s `surface` becomes a function of the section's index in the
*resolved, enabled-only* list rather than a literal at each call site.

*Why:* with a fixed order, hardcoding each band's surface worked because the
author could see the whole sequence. Once the merchant controls the order, any
fixed assignment produces three identical adjacent surfaces as soon as they
reorder — which is exactly the "one long column in one colour" that
`add-landing-page-theme-tokens` set out to remove.

*Why enabled-only:* computing over the full list would leave a gap in the
alternation wherever a section is disabled, producing two adjacent bands on the
same surface — the same defect by a different route.

The call-to-action strips keep their accent wash rather than joining the
alternation, because their surface is carrying meaning rather than rhythm.

### D6. Validation mirrors `homeConfigSchema`, including `.strict()`

A `sectionConfigSchema` in `landing-page.validation.ts`: an array of a
discriminated object, `.strict()`, with a `superRefine` for the cross-entry
rules (unique custom ids, custom-section count limit, no repeated built-in key).

*Why `.strict()`:* it is what makes an unrecognised field a rejected save rather
than a silently dropped one. The `homeConfig` comments record what this costs —
a field the admin starts sending before the schema declares it fails the whole
save — and that is the correct trade for a column Postgres does not check.

*Why the cross-entry rules are in `superRefine` and not per field:* uniqueness
and count are properties of the list, and a per-field rule cannot see the list.

*Why no DB read in validation:* the repo's stated convention — invariants that
need a read belong in the service, transactionally. Nothing here needs one.

### D7. The admin page is a settings editor, not a CRUD page

A new `admin/src/features/ui/landing-sections/`, built on `useSettingsDraft`,
`useUnsavedChangesGuard` and `ReorderableList`.

*Why that scaffolding:* it is what `home-sections-page.tsx` uses, and the draft
semantics matter here — `edited ?? saved ?? loaded ?? fallback` means a
background refetch cannot overwrite a half-finished reorder.

**The partial-PATCH discipline does not apply the same way**, and this is worth
stating because it is the obvious assumption: the settings editors coexist by
sending disjoint key sets to one singleton `PATCH /settings`. This page writes to
a *landing page row*, through the landing page's own update endpoint, so it is
not sharing an endpoint with the other UI editors. It must still send only
`sectionConfig` and not a whole-page payload, or it will clobber content written
by the landing page form.

*Route registration is in two places* — `nav-config.ts` and `app-router.tsx` —
and both are required. Role gating is by an explicit `<RoleGuard>` in the router;
the nav entry only controls sidebar visibility.

### D8. Custom section bodies go through the existing sanitiser

Rendered with the same `RichText` path as `bodyHtml`, sanitised at the point it
meets the browser.

*Why not a new sanitiser:* there is one allow-list, and a second one is a second
thing to get wrong. The spec requires only that unsafe markup does not execute;
the existing path already delivers that and is already the convention for every
merchant-authored HTML surface.

## Risks / Trade-offs

- **An existing page renders differently after deploy** → The whole of D1's
  nullable column and D4's fallback exist for this. It is the first thing the
  verify script must pin: a page with `sectionConfig = NULL` produces the same
  section sequence and the same surfaces as the current hardcoded JSX.

- **A merchant disables every section and ships a blank campaign page** → The
  hero and the order form are the page's reason to exist. Treat them as not
  disableable rather than trusting a warning: a warning is dismissed once and
  the page stays blank while the ads run.

- **Two writers on one landing page row** → The section editor and the landing
  page form both write to the same row. If the section editor sends a full page
  payload it will overwrite content the form saved. Mitigation: it sends only
  `sectionConfig`, and the service treats an omitted key as "leave unchanged",
  per the repo's `.optional()` convention.

- **Stored order drifts from the registry over time** → D4 handles both
  directions, but it only works if it is exercised. Both drift cases get a
  verify script case, not just the happy path.

- **Surfaces recomputed per position could flip a page's look on an unrelated
  save** → Alternation is computed from the resolved enabled list, so it is
  stable for a stable order. It does mean disabling a section can change the
  surface of the ones below it; that is the intended behaviour and the
  alternative (fixed surfaces, adjacent duplicates) is worse.

- **`CUSTOM` repeating is the `MID_BANNERS` hazard again** → It is named in the
  constants, and matching on `key` alone is the specific mistake to look for in
  review. The admin writing the list back with an entry that has lost its `id`
  is the same silent-drop failure the promo strips already documented.

- **Cache invalidation missed on a path** → Every mutating path must fire
  `landing-pages`, not just the obvious one. The repo's rule is to audit per
  Prisma model across `src/`, not per service file, and the fire must be after
  the transaction resolves.

## Migration Plan

1. Add the nullable column. No backfill — `NULL` is the meaningful default, and
   backfilling would convert "never configured" into "explicitly configured this
   way", losing the distinction D1 depends on.
2. Ship the storefront resolution with the fallback **before or with** the admin
   editor, so a stored order can never arrive at a storefront that cannot read
   it.
3. The admin page writes an order only when the merchant saves, so pages remain
   on the fallback until touched deliberately.

**Rollback:** revert the code; the column becomes unread. Stored orders are
retained and take effect again on re-deploy, so a rollback costs no merchant
work.

**Migration hygiene:** after `prisma migrate dev`, open the generated SQL, delete
the three `DROP INDEX` lines for the trigram indexes, and carry the NOTE block
forward from the previous migration. This is not optional — committing those
drops degrades product search to a sequential scan.

## Open Questions

- Which layout choices a custom section should offer beyond a plain
  heading-and-body. A sensible starting set can ship and be extended without
  changing the stored shape, since `layout` is already a per-entry field.
- Whether the section editor belongs on its own admin route or as a tab within
  the existing landing page form. Both use the same stored value and the same
  endpoint; this is a navigation choice that does not change the specs or the
  task breakdown.
