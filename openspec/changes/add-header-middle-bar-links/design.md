## Context

See proposal.md — Why.

What shapes the approach is that the header's main row is the one header surface with **no configurable slot**. Its action group (`Header.tsx`, the `ml-auto hidden items-center gap-5 md:flex` div) holds four hardcoded components — Wishlist, Compare, Cart, Account — each gated on its own condition. The announcement bar above it is fully merchant-driven; the nav row below it is fully merchant-driven; this row is not. That is why Track Order ended up in the announcement bar in the first place.

Three existing facts do most of the work:

- **`announcementBar.links` is already the shape we want**: `{ icon?, label, href }`, Iconify icon names, a zod array with a cap, edited through `EditorSubsection` + `EditorRow` + `LinkTargetInput`. The new list is that minus the `source` binding.
- **`PATCH /settings` is a partial upsert**, and the Header Links editor already owns two keys. A third key on the same editor changes nothing about the disjointness arrangement — the risk would be putting it on a *different* editor.
- **Track Order exists in two places today**: `FALLBACK_SETTINGS.announcementBar.links` in the storefront (a constant, edited in code) and real shops' saved `announcementBar` JSON (data, needing a migration). Both must move or the link renders twice.

## Goals / Non-Goals

**Goals:**

- Give the main row a configurable slot, so this class of link has a correct home rather than a second hardcoded button.
- Move the existing Track Order entry with no merchant action and no window in which it renders twice.
- Reuse the announcement bar's editing and rendering machinery rather than growing a parallel one.

**Non-Goals:**

- Making Wishlist, Compare, Cart or Account configurable. They carry live state (counts, auth) and are components, not links.
- Any change to the announcement bar's contract — its shape, its `source` binding, its cap.
- A mobile surface for these links. See Decision 4.
- Badge counts, active-route highlighting or dropdown children on these entries. They are plain links.

## Decisions

### Decision 1: A new column, not a flag on the announcement bar

`middleBarLinks` is its own `Json?` column on `StoreSetting`, sibling to `mainNav` and `announcementBar`.

**Alternative considered — a `placement: "announcement" | "middle"` field on each announcement link.** Rejected: it makes one setting mean two rows, so the admin would have to split one list into two visual groups and reassemble them on save, and a merchant's six-link cap would be shared across two rows that have completely different space budgets. The two lists also differ in kind — `source` binding makes sense for a contact strip and not for an action row.

**Alternative considered — extending `mainNav`.** Rejected: `mainNav` supports one level of dropdown children and renders in the sticky nav row. These are flat, iconed, and render in a row that does not stick.

A separate column also makes the migration expressible as a move between two columns, which is what lets it be idempotent.

### Decision 2: The migration moves data, and is written to be safely re-runnable

The migration does two things: add the column, and move any `/track-order` entry out of `announcementBar.links` into `middleBarLinks`.

It is expressed as raw SQL over the JSON columns rather than a script, so it runs exactly once as part of the normal migration path and cannot be forgotten on a deploy.

**Matching is on the target, not the label.** A merchant may have renamed it "Track my parcel"; the `href` is what identifies it. Matching on `/track-order` exactly, consistent with how the codebase already treats that route as a known target in the admin's `STOREFRONT_ROUTES`.

**Re-running must not duplicate.** The move appends to `middleBarLinks` only when no entry there already targets `/track-order`, and removes from `announcementBar.links` in the same statement. A second run finds nothing to move. This matters because the spec requires that a merchant who deletes the entry does not get it back — and while a migration normally runs once, an operator restoring a database and re-running is not an exotic scenario.

**Per the repo's standing hazard**: the generated SQL must be opened and any `DROP INDEX` lines for the three trigram indexes deleted, with the NOTE block carried forward from the most recent migration. Note that `20260916183105_add_hot_path_indexes` declared those indexes in the schema, so Prisma should no longer emit the drops — **verify rather than assume**, since committing them silently degrades product search to a sequential scan.

### Decision 3: Rendered inside the existing action group, before the cart

The links render as the first children of the `ml-auto hidden items-center gap-5 md:flex` group, using the same `HEADER_ACTION` class the four built-ins share.

Placing them *inside* that group rather than beside it is what makes them inherit its `ml-auto`, its gap and its breakpoint automatically — and it is why an empty list costs nothing: zero children rendered into an existing flex container leaves the row byte-identical to today.

**Single-line label, not the two-line label-then-value pattern.** The built-in actions read label-then-value ("My Cart / 0 Items") because they each have a live value to show. These have none, and inventing a second line would be filler. A single line at the same size and weight, with the icon at the same 22px, is the honest version of the same treatment.

**Icons are Iconify names**, matching the announcement bar — the storefront already has the `Icon` component and the merchant already enters names in this format on the same admin page. The built-ins use Lucide components, but those are not merchant-supplied and cannot be.

### Decision 4: Desktop only, because that is what the row is

The group these links join is already `hidden md:flex`. Rendering them on mobile would mean choosing a different surface — the bottom nav (five fixed slots, full) or the drawer (a different information architecture) — which is a separate decision with its own trade-offs.

The honest framing is that this change moves a link within the desktop header; it does not claim to solve mobile placement. Track Order is reachable on mobile the way it is today: through the footer and by URL. If that proves insufficient, adding a mobile surface is a follow-up with its own proposal, not a detail to settle here.

### Decision 5: Capacity 4, below the announcement bar's 6

The announcement bar is one wide row holding a truncating text and its links. This row already holds the brand, a `max-w-2xl` search box and up to four actions, and it is the row that runs out of horizontal space first — at `lg` and below, Wishlist and Compare are hidden precisely because of that pressure.

Four is chosen as the number that cannot overflow the row even when every built-in action is visible. It is a limit on how much a merchant can crowd a row they cannot see the constraints of, not a technical bound.

### Decision 6: Both fallback and default move together

`FALLBACK_SETTINGS` in the storefront stops listing Track Order under `announcementBar` and lists it under `middleBarLinks`. The backend's default for the new column does the same.

These two must change in the same commit as the migration. Leaving the storefront fallback as-is would mean a settings outage rendering Track Order in the *old* place while every healthy read renders it in the new one — a discrepancy visible only during an incident, which is exactly when nobody is in a position to diagnose it.

The storefront's mapper follows the existing convention for this file: absent or malformed input falls back per-field rather than discarding the whole payload.

### Decision 7: No interaction with the home-section nav rule

`align-nav-links-with-home-sections` suppresses a `mainNav` link whose target is governed by a disabled home section. `/track-order` is not in `SECTION_LINKED_ROUTES` and no home section fills it, so nothing here is suppressed.

Stated explicitly because the two changes touch the same admin page and the same header component, and a reader could reasonably assume the rule generalises. It does not: that rule is scoped to `mainNav`, and extending it to this list would need its own decision.

## Risks / Trade-offs

**The migration runs against production JSON and could corrupt `announcementBar`** → The highest-consequence risk here. Mitigations: match on `href` exactly; write the filter so a row with no `links` array, or a null `announcementBar`, is left untouched rather than rewritten; verify against a copy of production data before deploying; and confirm the row count affected matches the number of shops expected.

**Track Order renders twice during a partial deploy** → The migration and the storefront fallback change ship together, but the storefront and server deploy separately. A server that has migrated while the storefront still reads the old fallback is safe (the fallback is only read on failure); a storefront deployed first would render an empty middle bar until the migration lands. **Deploy the server first**, which is also the repo's existing build order.

**The row overflows on a narrow desktop** → Capped at 4, and the row already hides Wishlist and Compare below `lg`. A merchant who adds four long labels can still crowd it; the cap bounds the damage rather than preventing it, and the admin states the limit.

**A merchant expects these on mobile** → Named as a non-goal (Decision 4) rather than silently absent. The admin section description says the row is desktop-only, so the limitation is visible where the decision is made.

**Yet another list on the Header Links page** → That page now edits three lists. Mitigated by using the same `EditorSection`/`EditorRow` scaffolding so the third reads as more of the same rather than a new concept, and by ordering the sections top-to-bottom in the order they appear on the storefront.

## Migration Plan

1. Schema column + migration (server), verified against a production copy.
2. Backend default, validation and read path.
3. Storefront types, mapper, `FALLBACK_SETTINGS` move, and `Header` rendering.
4. Admin type, limits mirror, and editor section.

**Deploy the server before the storefront.** Rollback: the storefront and admin revert cleanly. The migration does not, since it moved data — reversing it means a second migration moving the entry back, so the forward migration should be verified carefully rather than relied on to be undoable.

## Open Questions

None. Placement, configurability and migration behaviour were settled before this document; capacity and the desktop-only boundary are recorded as decisions above.
