## 1. Print frame and page breaks

- [x] 1.1 Add `break-after: page` / `break-inside: avoid` rules for a batch document wrapper in `admin/src/features/sales/orders/documents/print.css`, suppressing the break on the last wrapper; verify a two-document batch produces exactly two sheets in the browser's print preview with no trailing blank page.
- [x] 1.2 Extend `PrintFrame` with an optional multi-document mode that renders a sequence and shows the batch count in the toolbar, keeping the existing paper-size toggle, persisted choice, title effect and `@page` body class shared; verify the single-order print route still behaves exactly as before.
- [x] 1.3 Point the multi-document frame's back button at the orders list rather than an order; verify it returns to `/sales/orders`.

## 2. Bulk document page

- [x] 2.1 Create the bulk document page component that reads `ids` from the query string, splits and validates them, and fetches each order with `useQueries` over the existing `getOrder`; verify a selection of three ids issues three queries and reuses any already cached.
- [x] 2.2 Render documents only once every query has settled, showing a loading state until then; verify a batch cannot be printed while any order is still loading.
- [x] 2.3 Read `useStoreSettings` once and pass it to every document; verify one settings query is issued regardless of batch size.
- [x] 2.4 Render the correct component per `:document` param, reusing `PackingSlip`, `Invoice` and `ShippingLabel` unmodified; verify a batched invoice shows the same totals and amount due as the same order's single invoice.
- [x] 2.5 Handle an unknown `:document` param and an empty or malformed `ids` param with an explicit empty state; verify neither renders a blank printable page.

## 3. Cancelled-order exclusion

- [x] 3.1 Filter `CANCELLED` orders out of the batch before rendering; verify a six-order selection containing two cancelled orders produces four documents.
- [x] 3.2 Show a `no-print` banner naming the excluded order numbers and stating cancellation as the reason; verify the banner appears on screen and is absent from the print preview.
- [x] 3.3 When every selected order is cancelled, show an explicit "nothing to print" state instead of an empty frame; verify no printable page is rendered.
- [x] 3.4 Surface a failed order fetch the same way as an exclusion — named on screen, batch still printable — rather than failing the whole run; verify one unreachable order does not block the other documents.

## 4. Route and selection entry point

- [x] 4.1 Register `/sales/orders/print/:document` in `admin/src/routes/app-router.tsx` outside `ShellLayout`, beside the existing per-order print route and with the same `<RoleGuard>`; verify the printed page carries no sidebar or topbar.
- [x] 4.2 Add the print action to the orders list bulk bar offering the three documents, navigating to the bulk route with the selected ids; verify the action appears only when at least one order is selected.
- [x] 4.3 Enforce the 50-order cap in the bulk bar — disable the action above the cap and state the limit — per design Decision 1; verify selecting 51 orders disables the action with a visible reason rather than producing a truncated batch.

## 5. Tests and verification

- [x] 5.1 Add cases to `admin/src/features/sales/orders/documents/documents.test.tsx` covering batch composition, one-document-per-order, and cancelled-order exclusion including the all-cancelled case; verify `npm run test --workspace admin` passes.
- [x] 5.2 Confirm a batched document renders identically to its single-order form for all three document types; verify by comparing rendered output for the same order through both routes.
- [ ] 5.3 Run `npm run lint --workspace admin` and `npm run build --workspace admin` (the build type-checks; there is no separate typecheck script); verify both pass with no new warnings in the touched files.
- [ ] 5.4 Print a real batch of at least six orders at both thermal and A4; verify each document starts on its own sheet, the remembered paper size applies to the whole batch, and no interface chrome reaches the paper.
