# Design — bulk fulfilment document printing

## Context

See `proposal.md — Why`. Three existing facts shape the approach:

1. **Documents render from the standard order projection.** `OrderDocumentPage`
   reads `useOrder(orderId)` and passes the result straight to `PackingSlip`,
   `Invoice` or `ShippingLabel`. There is no document endpoint and nothing is
   persisted (`design.md Decision 7` of the original change), so producing N
   documents is N of the same read, not a new contract.
2. **Print routes are mounted outside `ShellLayout`.** That placement is load
   bearing, not cosmetic: the original design rejected hiding chrome with
   `@media print` because every ancestor's layout still participates in the
   printed page. The bulk route inherits this constraint exactly.
3. **The orders list already owns a selection.** `selection` is an array of
   order ids, already drives the dispatch dialog, and is already cleared when
   rows leave the view. Bulk print consumes what is already there.

The operator's actual workflow, stated by the merchant: filter the list to one
status, select the results, print the batch. So the common selection is
homogeneous, and mixed selections are the exception rather than the norm.

## Goals / Non-Goals

**Goals:**

- One print command for a whole selection, with each document on its own sheet.
- Batched documents byte-identical in content to their single-order form.
- Reuse `PackingSlip` / `Invoice` / `ShippingLabel` without modification.

**Non-Goals:**

- A backend batch endpoint. N parallel reads of an existing endpoint is not a
  performance problem at the scale of one packing session.
- Server-side PDF generation. The browser's own print pipeline already produces
  the paper; introducing a PDF renderer would mean a second layout engine to
  keep in step with the CSS.
- Selecting across pages. The list's selection is per-view and is deliberately
  cleared when rows leave it; changing that belongs to the list, not here.
- Per-order paper sizes within one batch. One batch, one printer, one size.

## Decisions

### Decision 1 — Ids travel in the query string, capped, with the cap enforced at selection

The route is `/sales/orders/print/:document?ids=<id>,<id>,…`.

The alternative — passing ids through `react-router` location state — survives
no reload and cannot be reopened from history, which is exactly what an
operator does when a print job jams. A query string is addressable and
re-runnable.

Its cost is URL length. Browsers and proxies vary, but ~2000 characters is the
conservative ceiling; a CUID is 25 characters plus a separator, so the practical
limit is around 75 ids. The cap is therefore **50 orders per run**, enforced
where the operator can see it (the bulk bar disables the action and says why
above 50) rather than discovered as a truncated batch or a failed navigation.

Fifty is chosen rather than 75 to leave headroom, and because it matches the
courier dispatch batch size already used in `courier.service.ts` — an operator
who learns "fifty at a time" learns it once.

### Decision 2 — `useQueries`, and the batch renders only when every order has loaded

Each id is fetched with the same `getOrder` the single route uses, through
TanStack Query's `useQueries`. Cached orders resolve instantly; the list the
operator just came from will usually have warmed several.

The page renders documents only once **every** query has settled. Rendering
progressively would let an operator hit Ctrl+P against a half-loaded batch and
print six labels out of twelve with nothing to indicate the rest were still
arriving. A batch is an all-or-nothing artefact, so the loading state is too.

A failed fetch is surfaced the same way an excluded order is (Decision 4) —
named on screen, with the rest of the batch still printable — because refusing
the entire run over one unreachable order would strand a packing session.

### Decision 3 — Page breaks via `break-after`, not a fixed page height

Each document is wrapped in a container carrying `break-after: page`, with
`break-inside: avoid` so a document does not split where it need not. The last
document's break is suppressed to avoid a trailing blank sheet.

The alternative — giving each wrapper a fixed height of one page — was rejected
because it hard-codes A4 and breaks the thermal path entirely: thermal is a
continuous roll whose "page" length is whatever the content is. `break-after`
delegates that to the print pipeline, which already knows the paper.

`break-after` rather than the legacy `page-break-after`: both are supported, but
the modern property is what the existing `print.css` should be growing toward.

### Decision 4 — Cancelled orders are dropped from the batch and named on screen

The filter is on `CANCELLED` status alone. Every other status can legitimately
need paper — a pending order gets a packing slip when it is picked, a delivered
one may need a reprinted invoice.

The exclusion is reported in a `no-print` banner listing the excluded order
numbers. Silence was the tempting option and is wrong: the merchant's workflow
is filter-then-select-all, so a cancelled order reaching a batch means the
filter did not do what they thought, and that is worth seeing. The banner
carries `no-print` so it never reaches paper.

When the exclusion empties the batch, the page says so instead of rendering an
empty print frame — an operator pressing Print on a blank page has no way to
tell a bug from an empty selection.

### Decision 5 — `PrintFrame` gains a multi-document mode rather than being forked

`PrintFrame` already owns the paper-size toggle, the persisted choice, the
document-title effect and the `@page` body class. All of that applies unchanged
to a batch.

So it takes an optional count and renders its children as a sequence, rather
than a `PrintFrameBulk` twin that would duplicate four behaviours and drift on
the first change to any of them. This mirrors the admin's own stated lesson from
`remove-antd-from-admin`: one authoring component with callers passing in what
differs, not a suffixed second variant.

The toolbar gains the batch count ("12 documents") and its back button returns
to the orders list rather than an order.

### Decision 6 — Store settings are read once for the batch

`useStoreSettings` is a single query feeding every document, not one read per
order. It is the same store on every sheet.

## Risks / Trade-offs

- **A 50-order cap is a limit an operator can hit.** → It is stated in the UI
  before it is hit, not after. A merchant needing more prints two runs, which is
  still two commands instead of fifty.
- **N parallel requests on a cold cache.** → Bounded by the cap, and TanStack
  Query dedupes and caches; the orders list the operator arrives from has
  usually warmed part of the set. If it proves slow, the fix is a batch endpoint
  on the backend, which this design does not preclude.
- **Thermal batches produce a long roll.** → Each document still starts on a new
  "page", which on a roll is a feed break rather than a sheet. This is what a
  thermal batch should do; cutting between documents is the operator's.
- **A reprint of a partly-jammed run reprints everything.** → Out of scope and
  stated rather than hidden: per-document reprint is what the existing
  single-order route is for.

## Migration Plan

Purely additive. A new route, a new page component, an optional mode on
`PrintFrame`, one action added to the bulk bar, and page-break rules added to
`print.css`. The existing per-order print route, its components and its
behaviour are untouched, so rolling back is removing the new route and the bulk
bar action.

## Open Questions

- Whether the bulk bar should offer the three documents as separate buttons or
  one menu. A presentation detail that changes no requirement; the implementer
  should match whatever the bulk bar's existing dispatch action looks like
  beside it.
