## Context

See proposal.md — Why. Five things already in place decide almost everything here.

**`purchasePrice` is already a maintained cost basis, and its flow is documented as one-way.** `add-weighted-average-cost-basis` made it mean "what the stock on hand cost", maintained by `receivePurchaseOrder` as a moving weighted average over landed cost. Both `Product.prisma` and that change's catalog delta state the rule outright: a receipt writes the cost basis, and the cost basis never writes back into a purchase order. This change adds a *second* write in that same direction — receipt to catalog, now for selling prices too — and must not open the reverse one.

**The receipt is already a single transaction with a post-commit notification.** `receivePurchaseOrder` computes `allocateLandedUnitCosts` for every line, then inside one `prisma.$transaction` per line: reads the product and variant rows (`purchasePrice`, `offerPrice`), reads `onHandBefore` from the `Stock` aggregate *before* incrementing, updates `receivedQuantity`, finds-or-creates `Stock`, writes a `StockMovement`, calls `applyDenormalizedStockDelta`, and writes the new cost basis. It collects `costOutcomes` in the loop and, after commit, compares each item's `newCost` against its `effectiveOfferPrice` to decide who to warn. Every hook this change needs exists; nothing new has to be threaded through.

**The receipt already warns rather than blocks on an inverted margin**, and the inventory capability requires it to: "A goods receipt is never rejected for pricing the item above its selling price." So the answer to "what if the new cost exceeds the price" is not a decision this change makes — it is existing, specified behaviour that this change extends to cover staged prices.

**The admin's PO form already resolves each line's full product.** `purchase-order-form-page.tsx` renders a per-line resolver that calls `useProduct(productId)` to discover the product's variants, and `IProduct` in `admin/src/lib/api/products.ts` carries `purchasePrice`, `offerPrice` and `sellingPrice`. The three prices and the cost default are therefore available with no new request — the data is already in hand and merely unused.

**`purchase-order.cost.ts` is deliberately Prisma-free**, because "these are the two calculations that can actually be wrong", and `scripts/verify-cost-basis.ts` exercises them as plain function calls. The pricing helpers are the same kind of thing and belong in the same file for the same reason.

Also in force: money is `Decimal(12,2)` computed in cents; every mutating service call takes `userId` first and records an `AuditLogService.record`; the admin's PO form splits its save across two endpoints (`PATCH /:id` for scalars, `POST /:id/items` to amend lines) and the scalar endpoint refuses every edit once receiving has begun.

One planning note that shaped the spec deltas rather than the code: `add-weighted-average-cost-basis` is still unarchived, so the requirements it adds to `api/inventory` and `api/catalog` are not yet in those main specs. This change's deltas are therefore ADDED requirements that sit alongside them, not MODIFIED text — there is no target to modify yet. Archiving the two in order will leave both sets in place.

## Goals / Non-Goals

**Goals:**

- The unit cost a merchant needs is already in the field when they pick a product.
- The margin consequence of a shipment is visible while costing it, not discovered later on another screen.
- A new selling price can be set where the new cost is learned, and takes effect exactly when the stock it prices does.
- An order that is never received cannot change a live catalogue.
- The pricing arithmetic is pure and unit-testable, like the cost arithmetic beside it.

**Non-Goals:**

- Changing how `purchasePrice` is computed. The weighted average over landed cost is untouched.
- A price-history model, a per-supplier price list, or a default markup stored per product or category.
- Editing `purchasePrice` directly on a line. A line already sets it, through `unitCost`.
- Any reverse flow: the catalog's prices are never copied onto a line as a stored value.
- Repricing on any event other than a goods receipt.

## Decisions

### 1. Two nullable staged-price columns on `PurchaseOrderItem`, not a rule or a JSON blob

**Chosen:** `stagedOfferPrice Decimal? @db.Decimal(12,2)` and `stagedSellingPrice Decimal? @db.Decimal(12,2)`.

Nullable is the whole compatibility story: every existing row predates the field, and absent has to keep meaning "this line has no opinion about the selling price". That is also what an untouched line means going forward, so there is one representation of that state rather than two.

Two scalar columns rather than a `stagedPrices Json` field because Postgres does not constrain Json and, per the root conventions, a Zod schema would then be the only gate on a money value — for a pair of `Decimal(12,2)` figures that a plain column type checks for free.

**Rejected:** storing the *rule* (`{ basis: 'unitCost', percent: 25 }`) instead of the resulting figure. It sounds more expressive and is worse: the rule would have to be re-evaluated at receipt, against a `unitCost` the merchant may have amended since, so the price applied would not be the price the line showed. Decision 4 makes the helpers compute-and-fill for this reason; the column stores the answer.

**Rejected:** a `markupPercent` column on `Product` as a standing default. That is a different feature — pricing policy — and would reprice on every receipt without anyone asking.

### 2. Staged prices are applied on goods receipt, inside the existing transaction

**Chosen:** `receivePurchaseOrder` writes the line's staged prices in the same per-line block that writes the cost basis, in the same `prisma.$transaction`.

This is the decision the whole change turns on, and it follows from what a receipt already is. `purchasePrice` moves on receipt because receipt is the moment the stock it describes exists; a selling price staged against that stock has exactly the same trigger. Applying it in the same transaction means a receipt can never leave stock recorded at a new cost while the price staged against it is unwritten — the same guarantee the cost write already states.

**Rejected: writing on save.** A draft purchase order would reprice a live storefront before any goods existed, and a cancelled one would leave the reprice behind. The merchant's own framing was that the purchase order is where cost is *discovered*; discovery is not delivery.

**Rejected: a per-order "apply now / apply on receipt" toggle.** Two code paths, a decision on every order, and the "now" path carries the draft-reprices-storefront problem regardless. If a merchant genuinely needs an immediate reprice they have the product form, which is the screen for that.

**Consequence, stated because it is the cost of the choice:** between staging and receiving, the line and the product disagree, deliberately. The line must therefore show the staged value *and* the current one, or a merchant reading the row cannot tell which is live — see Decision 5.

### 3. Applied once per line, on the first receipt against it

**Chosen:** a staged price is applied when a line goes from `receivedQuantity === 0` to non-zero, and not on later partial receipts of the same line.

The alternative — apply on every receipt — loses a correction. A merchant receives half a shipment, sees the new price in the catalogue, decides it is wrong, fixes it on the product form, then receives the rest: re-applying would overwrite their fix with the stale staged figure, and they would have no idea why. Applying once makes the staged price a proposal that is consumed, which is what it is.

`receivedQuantity` is already read in the loop and already the thing that distinguishes a first receipt from a subsequent one, so this costs a condition, not a column. The staged values are deliberately *not* cleared on application: the line stays the record of what was applied, which is what makes the receipt auditable.

### 4. The helpers compute and fill; they are not stored and not re-evaluated

**Chosen:** two pure functions in `purchase-order.cost.ts` — `markupOnCost(unitCost, percent)` and `adjustByAmount(price, delta)` — each returning a `round2` figure. The admin calls them to populate a staged-price input, which the merchant may then edit.

They live beside `allocateLandedUnitCosts` and `weightedAverageCost` for the reason that file's header already gives: these are calculations that can be wrong, and keeping them free of Prisma is what lets `verify-cost-basis.ts` exercise them with plain calls. The admin needs the same arithmetic in the browser; it is small enough to mirror, and the server is the authority for the rounding.

Markup is on `unitCost` rather than on landed cost, which was deliberately considered: landed cost depends on header-level shipping and tax apportioned across *all* lines, so it changes when an unrelated line is edited, and a markup the merchant computed would silently stop matching the figure shown. `unitCost` is the number on the row in front of them. Landed cost remains the basis for the *cost basis*, which is the figure that must be accounting-correct.

A markup on a zero or negative `unitCost` returns nothing rather than zero. A percentage of nothing is nothing, and proposing a price of 0.00 for a line nobody has costed yet is worse than declining. `adjustByAmount` clamps at zero for the mirror-image reason: a decrease that would produce a negative price is a mistake, and storing it would put a negative money value in a `Decimal(12,2)` column that every reader assumes is non-negative.

### 5. The line shows current and staged prices as distinct things

**Chosen:** each line displays the item's three current prices as read-only figures, and the two staged prices as inputs that are empty until set. An input showing a value means "this will change on receipt".

Pre-filling the staged inputs with the current prices was rejected, and it is the subtle one. It reads as helpful and destroys the distinction the schema depends on: every line would then carry staged values equal to the current ones, "no opinion" would become unrepresentable, and every receipt would write prices it was never asked to. Empty-means-no-change is the only encoding that keeps a line silent by default.

`unitCost` is different and *is* pre-filled from `purchasePrice`, because `unitCost` has no null state — the column is required, the form already defaults it to `0`, and a defaulted-to-cost-basis figure is strictly better than a defaulted-to-zero one. The merchant overwrites it with what the supplier charged, which is what the field means. The seed must not re-apply after the merchant has typed a cost; only changing the product or variant re-seeds it.

Variant precedence for all four figures is the variant's own value falling back to the parent's, matching what `receivePurchaseOrder` already does when it values the line. Anything else would show one number and act on another.

### 4a. The helper CONTROLS were removed from the admin (Decision 4 reversed in the UI)

**Chosen (after implementation, on the merchant's request):** the markup and
fixed-adjust controls are gone from the line pricing panel. The two staged
inputs remain, and every figure in them is one a merchant typed.

The merchant's reason is that these prices come off a supplier's invoice rather
than being derived from cost, so the controls occupied the panel's width and
reading without answering a question they had. Decision 4's arithmetic reasoning
was sound; the premise that a merchant wants a computed selling price was not.

**Only the UI went.** `markupOnCost` and `adjustByAmount` remain in
`purchase-order.cost.ts` and remain covered by `verify-cost-basis.ts`, so
restoring the controls is a UI change rather than a re-derivation. The admin's
mirror of the two functions was deleted, which also retires the drift risk the
Risks section listed.

**Consequence:** nothing computes a staged price now. The "no automatic reprice"
guarantee in proposal.md is strengthened rather than weakened — there is no
longer any path that fills a staged price except typing one.

### 5a. The pricing controls live in an expandable row per line, not in new columns

**Chosen (settled during implementation, on the merchant's answer):** each line keeps a chevron that opens a second row beneath it, holding the three current prices, the two staged inputs and the helpers. The main table is untouched.

The line-item table already carries seven columns — Product, Variant, Qty, Unit cost, Received, Amount and the delete button — and the pricing feature needs five more things per line. Adding them as columns means roughly twelve, which forces horizontal scrolling to reach the delete button and makes the common case (cost a line, save) worse to serve the uncommon one (reprice while costing).

An expandable row also matches what the feature *is*: repricing is per line and occasional, so it should cost a click and be absent until asked for. It keeps the empty-by-default encoding of Decision 5 visible too — a collapsed row shows nothing staged, which is exactly what an untouched line means.

*Rejected:* current prices inline under the product name with the staged inputs in a dialog. A dialog hides the unit cost the markup is computed from, so the merchant would be marking up a number they cannot see. *Rejected:* all five as columns with horizontal scroll, for the reason above.

### 5b. Items are chosen before the line exists; the row is read-only text

**Chosen (after implementation, on the merchant's request):** line items are
added from a search bar above the table. A product with variants opens a dialog
naming which variant; a simple product is added directly. The row then shows
Product and Variant as TEXT, and the per-row comboboxes are gone.

The old flow was "Add item" → blank row → find the product in the row's
combobox → then the variant in a second one. Two steps after the one the
merchant was thinking in ("I want this product"), with the row sitting in a
state that fails validation in between.

Moving the choice ahead of the line makes an invalid line unreachable rather
than merely refused: a variable product's line could previously sit on the table
naming no variant until save caught it, and that check — `Choose which variant
this line is for` — now has nothing to catch, because a dismissed dialog adds
nothing at all. It is also what lets the row be text: once there is nothing left
to choose, a control there would only offer a way back into the state the dialog
exists to prevent.

**The duplicate rule:** same product AND same variant increments the existing
line; a different variant of the same product gets its own line, because stock
is held per (warehouse, product, variant) and merging them would order the right
total of the wrong thing.

**Changing a line's item is now removing it and adding the right one.** Accepted:
it is rarer than adding, and the alternative is re-introducing the pickers whose
removal is the point.

*Rejected:* keeping the row's comboboxes alongside the search bar. Two ways to
say the same thing, and the row's way is the one that can produce the invalid
state.

**The variant dialog is a listbox, not a list of buttons.** It first shipped as
`<button>` elements, which answer arrow keys by doing nothing. It now follows the
contract `components/ui/combobox` already implements — highlight as state,
published through `aria-activedescendant`, options not focusable, Enter commits —
and `purchase-order-form-page.test.tsx` pins it, because every mouse-driven
assertion passed while the keyboard did nothing.

### 6. Validation stays a shape check; the invariant lives in the service

**Chosen:** Zod constrains the staged prices to non-negative money with two decimals, both optional. The rule that an offer price should exceed cost is *not* enforced on staging.

It cannot be: whether a staged price is above cost depends on the landed cost the receipt will compute, which depends on header shipping and tax and on every other line. That is a DB-read-and-arithmetic invariant, which per the root conventions belongs in the service, transactionally — and the service's answer, already specified, is to warn rather than refuse. Refusing at staging time would also refuse the legitimate case: a merchant staging a loss-leader deliberately.

### 7. Ships server-first, additive, no backfill

**Chosen:** server, then admin. The columns are nullable and additive, so no backfill; the server accepting a field no client sends is inert; and an admin that could stage a price the API rejects would be a form that fails on save.

The migration must have its `DROP INDEX` lines for the three `pg_trgm` indexes removed and the NOTE block carried forward, per the root CLAUDE.md warning — Prisma emits them into every generated migration and committing them degrades `ProductService.searchProducts` to a sequential scan.

## Risks / Trade-offs

- **A purchase order can now change customer-facing prices, which it could not before.** A merchant who stages a price by accident and receives the order has repriced their storefront. → Staged prices are visible on the line before receipt and on the detail page; empty-by-default means a line never stages anything unasked (Decision 5); the write is on the receipt's audit entry. Accepted rather than mitigated further: the feature *is* this power.
- **Line and product deliberately disagree between staging and receipt.** A merchant reading the line could take the staged figure for the live one. → Both are shown, labelled, and visually distinct; the staged input is empty when there is nothing staged.
- **Two receipts, one line, one correction in between.** → Decision 3 applies the staged price once. The cost is that a merchant who *wants* the staged price re-applied must re-stage it, which is the safer direction to fail in.
- **The admin mirrors the two helper functions in the browser.** Drift would mean the figure proposed differs from the server's arithmetic. → Both are `round2` over one multiplication or addition; the server is the authority and `verify-cost-basis.ts` pins it. If they ever grow a branch, the honest fix is an endpoint, not a bigger mirror.
- **`sellingPrice` has a meaning the staged field cannot express: null.** A product with no regular price is one with no offer running. A staged `sellingPrice` of null means "don't change it", so a receipt cannot *clear* a regular price. → Accepted and stated; clearing a regular price is a product-form action, and overloading null here would make "no opinion" unrepresentable again.
- **Trade-off accepted:** markup on `unitCost` rather than landed cost means the merchant's markup is on the invoice price, not the true shelf cost. Landed cost is the accounting-correct basis and remains so for the cost basis; it is the wrong basis for a control that must match the number on the row (Decision 4).

## Migration Plan

Additive and nullable: two columns on `PurchaseOrderItem`, no backfill. Every existing row reads as "no staged price", which is what it means.

Deploy **server, then admin**. The server alone is inert — no client sends the new fields, and `receivePurchaseOrder` finds null on every line and behaves exactly as it does today. The admin then starts offering the cost default, the displayed prices and the staged inputs.

Rollback is reverting the admin, then the server. A staged price already stored on an unreceived line is read by the reverted server as a column it does not select, so it is ignored and never applied; the data is inert rather than harmful. A staged price already *applied* is an ordinary product price and needs nothing.

## Open Questions

- Whether the detail page should offer to re-stage a price on a line that has already had one applied (a second delivery at a different cost). Deferrable: the line records what was applied, so the information is not lost, and re-staging is a superset of this change rather than a condition of it.
- Whether the markup helper should remember the last percentage used within a form session as a convenience. Purely a UI nicety; it stores nothing and changes no requirement.
