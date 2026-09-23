## Context

See `proposal.md` — Why. What follows is only the state that constrains the approach.

The admin already holds everything these documents need. `GET /orders/:id` returns the full detail projection (items with `productName`, `sku`, `quantity`, `unitPrice`, `totalPrice`; customer; shipping address; all four money columns), `usePaymentsByOrder` supplies what has been paid, and `useStoreSettings` supplies store name, logo, contact details, `currency`, `currencySymbol` and `currencyDecimals`. `order-detail-page.tsx` already loads the first three of these. So the documents need no new read path — this is a rendering feature sitting on data the page has in hand.

Two facts shape the rest:

- **`orderNumber` is `ORD-${YYYYMMDD}-${6 chars of [0-9A-Z]}`** (`order.service.ts:99`). Uppercase alphanumerics and hyphens only — a strict subset of Code 128 code set B.
- **`getOrders` declares `searchableFields: ["orderNumber"]`** (`order.service.ts:1157`). Order-number search already exists and is already exact-prefix capable through the existing QueryBuilder.

The hardware is an 80mm thermal receipt printer installed as a normal Windows printer, and a keyboard-wedge barcode scanner — one that types what it reads into whatever field has focus, followed by Enter. Neither needs a driver integration; both are addressable from a browser as-is.

The overriding constraint, stated by the merchant and adopted here as a design rule: **no new runtime dependency in any of the three apps.**

## Goals / Non-Goals

**Goals:**
- Three documents printable from the admin with hardware the merchant already owns.
- Barcodes that a commodity scanner reads back as exactly the order number.
- One rendering path serving both 80mm and A4, so a layout fix cannot land on one size and miss the other.
- `PACKED` added without disturbing the existing transition guard's shape.

**Non-Goals:**
- Server-side PDF generation, and therefore also emailing an invoice or archiving a rendered document. Nothing here persists a document; every one is re-rendered from the order on demand.
- Any change to how the storefront reads orders beyond displaying the new status.
- Bulk/batch printing of many orders at once. The data path would support it, but the pick-pack-label loop is per-order and batching is a separate workflow question.

## Decisions

### Decision 1: Hand-write the Code 128 encoder rather than add a barcode library

`jsbarcode`, `bwip-js` and the rest all solve a far larger problem than this one — dozens of symbologies, canvas and SVG renderers, font handling. What is actually needed is: one symbology, one character set, one output format.

Code 128 B is a small specification. The encoding is: a start code, one pattern per character, a modulo-103 weighted checksum, a stop code. The pattern table is 107 entries of six digits each. Each pattern is a run-length string of alternating bar and space widths, which maps directly onto SVG `<rect>` elements. The whole encoder is well under 150 lines and has no branching beyond "is this character in the table".

Chosen because the merchant asked for no dependencies, and because this is one of the rare cases where that ask costs almost nothing. A barcode is a pure function from string to bar widths; it has a single, verifiable right answer, is testable to the bit, and will never need updating — Code 128 was standardised in 1981 and has not moved since.

**Alternatives considered.** A barcode library: rejected on the no-dependency constraint, and because the bundle cost is real for a payload this small. A barcode *font* (Code 128 TTF): rejected because the font must still be installed on every machine that prints, which is exactly the kind of environmental dependency this change exists to avoid, and because checksum computation is still required by hand. A server-rendered barcode image: rejected because it puts a network round trip in the path of printing a label, and the spec requires labels to print offline.

**Correctness obligation.** The encoder gets unit tests asserting the exact bit pattern for known vectors, including the checksum — a barcode that is subtly wrong still *looks* like a barcode, so visual review cannot catch this class of bug. This is the one part of the change with a mechanically checkable right answer, and it is tested accordingly. The tests also cover a real `ORD-` number end to end, and the unencodable-character path from the spec.

### Decision 2: SVG, not canvas

The barcode renders as inline `<svg>` with one `<rect>` per bar.

Canvas rasterises at a fixed pixel density, and a thermal printer's 203 dpi does not match a screen's. A canvas barcode scaled to fit 80mm paper resamples its bars, and resampled bars are how a barcode becomes unscannable — the narrow-bar-to-wide-bar ratio, which is the entire information content, drifts under interpolation.

SVG is resolution-independent, so the same markup prints correctly at 203 dpi thermal and 600 dpi laser. It is also what makes the barcode a plain part of the printed document rather than an image the print pipeline might drop, and it needs no `toDataURL` round trip before `window.print()`.

### Decision 3: Print with `window.print()` and print-only CSS, in a dedicated route

Each document is a real admin route (`/orders/:orderId/print/:document`) rendering only the document, outside the app shell.

The alternative of rendering a hidden div inside the order detail page and hiding everything else with `@media print` works, but it is fragile in exactly the way the spec forbids: every ancestor's layout — the sidebar's flex container, any `overflow: hidden`, any `position: fixed` header — participates in the printed output, and a chrome change elsewhere in the admin silently breaks the label. A dedicated route has no ancestors to fight.

Paper size is selected by a `@page { size: ... }` rule: `80mm auto` for thermal, `A4` for the A4 variant, with margins to match. One React component per document renders one DOM; the size choice swaps only the stylesheet. This is what keeps a layout fix from landing on one size and missing the other.

Thermal specifics that the stylesheet must honour, because they are failure modes rather than preferences: a print width of 72mm inside 80mm paper (the printhead does not reach the edges), no background colours or shading of any kind (a thermal head prints black or nothing — a grey table header renders as a black block, or vanishes), and a minimum ~9pt body size.

### Decision 4: Persist the paper-size choice in `localStorage`, not in store settings

The spec requires the size choice to persist. It is deliberately kept per-machine rather than per-store.

Paper size is a property of *the printer in front of this operator*, not of the business. A merchant with a thermal unit at the packing bench and an A4 printer in the office needs both to remember their own answer, and a store-level setting would force one to be wrong. Keeping it out of `StoreSetting` also avoids adding a key to the shared singleton and the partial-PATCH coordination that comes with it (see `CLAUDE.md` — Settings-editor pattern).

### Decision 5: Scan-to-open reuses the existing list search; no new endpoint

The keyboard-wedge scanner types the order number and presses Enter. The orders list search field consumes that as an ordinary submitted query and calls the existing `GET /orders?searchTerm=`, which already searches `orderNumber`. On a result set of exactly one, the page navigates to that order's detail view; on zero or many it renders the list as normal.

Chosen because it is genuinely zero backend change — the search field already exists and already matches order numbers, so the entire feature is a `useEffect` on the query result. A dedicated `GET /orders/by-number/:orderNumber` would be marginally more direct but adds a route, controller, service function and verify script to save one comparison, and introduces a second lookup path that can disagree with the first.

The "exactly one" rule matters and is specified rather than assumed: `searchTerm` is a substring match, so a scanned number is not *guaranteed* unique as a query even though `orderNumber` is unique as a column. Navigating on the first of several results would open the wrong order. Requiring exactly one match makes the ambiguous case visible instead of silently wrong.

**Auto-focus.** The search field takes focus on mount so a scan works without clicking first. This is the whole ergonomic point — an operator holding a parcel in one hand and a scanner in the other should not need the mouse.

### Decision 6: `PACKED` as an `OrderStatus` enum value

Adding to the enum, rather than a `packedAt` timestamp on `Shipment` or an inferred state.

`PACKED` is a state the order is *in*, and the existing machinery — the transition guard, the status history, the list status filter, the admin's status dropdown — is all keyed on `OrderStatus`. A timestamp on a side table would be invisible to every one of them: "show me everything packed and awaiting pickup", which is the question the packing bench actually asks, would not be answerable by the order list.

The transition map gains `PROCESSING → PACKED` and `PACKED → SHIPPED`, and `PACKED` joins `RESTOCKABLE_ON_CANCEL_STATUSES` — a packed parcel is still on the premises, so cancelling it must credit stock back, which is precisely the boundary that list already draws.

**Migration note.** `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block in PostgreSQL, and Prisma wraps migrations in one. The migration must therefore be authored so the enum value is added in its own statement — verify this against a shadow database before committing, and if Prisma's generated form fails, hand-author the migration. This is the same class of constraint as the `CREATE INDEX CONCURRENTLY` limitation already documented in `CLAUDE.md`.

**And the standing trigram-index rule applies.** The generated migration will contain `DROP INDEX` for `Product_name_trgm_idx`, `Product_sku_trgm_idx` and `Brand_name_trgm_idx`. Those lines must be deleted and the NOTE block carried forward from the most recent migration. Committing them silently degrades product search to a sequential scan.

### Decision 7: Documents render from the order projection, not from a new server view

No server-side document endpoint. The admin composes each document from `useOrder`, `usePaymentsByOrder` and `useStoreSettings`.

This keeps the change's server surface to the enum and its transitions, and it means a document can never disagree with the order detail page — they read the same projection. It also satisfies the spec's staff-only requirement for free: `getOrderById` already strips `unitCost` for non-staff via `withoutItemCosts`, the print routes sit behind the admin's existing `RoleGuard`, and the admin is a staff-only application to begin with. The cost-basis prohibition in the spec is thus enforced at the source, not by remembering to omit a column in three templates.

## Risks / Trade-offs

**A subtly wrong barcode looks correct to the eye** → The failure is invisible until a scanner rejects a parcel at a courier depot. Mitigated by unit-testing the encoder against known-good bit patterns including the modulo-103 checksum, and by an explicit implementation task to scan a printed label with the merchant's own gun before the change is considered done. Visual inspection is not accepted as verification for this component.

**Browser print dialogs and page-break behaviour vary between browsers** → Mitigated by keeping the documents simple block layouts with no floats or multi-column flow, and by pinning the admin's supported print path to Chrome/Edge, which is what the merchant runs. A long packing slip spanning pages is the one place page-break control matters; `break-inside: avoid` on item rows covers it.

**`@page size: 80mm auto` is honoured inconsistently** → Some driver/browser combinations ignore the CSS size and fall back to the printer default. Mitigated by the printer itself being configured for 80mm paper in Windows, which makes the CSS a refinement rather than the sole mechanism; and by the A4 toggle, which is a working escape hatch if a given machine misbehaves.

**Adding an enum value touches three apps, and only one of them fails loudly** → The admin holds `Record<OrderStatus, ...>` maps (`STATUS_LABEL`, `STATUS_VARIANT`), so a missing `PACKED` case is a *compile* error — TypeScript surfaces it rather than production. The storefront does not: it renders status as `order.status.toLowerCase()` (`track-order/page.tsx:30`, `checkout/success/page.tsx:80`, `GuestOrderConfirmation.tsx:140`), which silently produces "packed" for any value the union does not yet list. That degrades acceptably rather than breaking, and it means the storefront work is one line — adding `"PACKED"` to the `OrderStatus` union in `nextjs/src/types/order.ts` — but it also means the storefront gives no compile-time warning at all. The deploy ordering below is what covers it.

**Scanner reads into the wrong field** → A keyboard-wedge scanner types wherever focus happens to be, so scanning while a dialog is open sends the order number into that dialog's input. Accepted rather than mitigated: guarding every input against scanner input is disproportionate, the operator sees the text land in the wrong box immediately, and nothing is submitted without Enter in a field that acts on it.

**Trade-off accepted: no stored document artifact.** Because documents are re-rendered on demand, an invoice reprinted after an order is edited shows the *current* order, not what was printed the first time. For an immutable-once-placed order this is almost always what is wanted, and it avoids storing and versioning rendered documents. If an audit trail of exactly-what-was-printed is ever required, that is a separate change and would need a stored artifact.

## Migration Plan

Deploy back to front, so no app renders a status it does not understand:

1. **Server** — enum value, transition rules, validation. Backward compatible on its own: nothing produces a `PACKED` order until staff can select it, and the value is additive so existing rows and queries are untouched.
2. **Storefront** — the `PACKED` label in the order timeline. Deployed before the admin can create the state, so a customer never sees an unlabelled status.
3. **Admin** — status labels, the print routes, and scan-to-open. This is the step that first makes `PACKED` reachable.

**Rollback.** Steps 3 and 2 roll back independently and cleanly. Step 1 does not: PostgreSQL cannot drop a value from an enum type, so the migration is effectively forward-only. This is acceptable because an unused additive enum value is inert — rolling back the admin removes the ability to *reach* `PACKED` without needing the type reverted. Any order already in `PACKED` at rollback time would, however, be stranded in a state the reverted admin cannot advance; if that risk needs eliminating, drain `PACKED` orders to `SHIPPED` before rolling back.

## Open Questions

- ~~Whether the shipping label should carry a store logo.~~ **Resolved during implementation:** the label omits it and the invoice includes it where configured. This also turned out to matter for the offline requirement — a logo is the one remote asset (`settings.logoUrl`) any of these documents loads, so keeping it off the label is what makes the label, specifically, print with no network at all.
