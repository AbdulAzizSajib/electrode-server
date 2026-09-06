## Context

Stock lives in two places that were maintained independently.

`Stock` is the ledger: a row per (warehouse, product, variant), holding `quantity` and `reservedQuantity`. Every change to it is accompanied by a `StockMovement` recording the type (PURCHASE, SALE, ADJUSTMENT, RETURN), the amount, and the record that caused it. This is what checkout reads — both the availability check and the deduction.

`Product.stockQuantity` and `ProductVariant.stockQuantity` are denormalized mirrors of that ledger. They exist for two reasons that a `SUM` over warehouse rows cannot serve: the storefront needs a total on every product card without an aggregate per product, and Prisma cannot `orderBy` a relation aggregate, so "sort by stock" is only possible against a stored column. The same reasoning already documented for `totalSold` and `viewCount` on `Product`.

Four paths maintained the mirrors correctly, by delta, inside the transaction that moved the ledger: purchase-order receiving, stock adjustment, return restocking, and checkout deduction. Product create and update did not — they wrote the column directly, from a number the merchant typed, with no ledger row and no movement behind it.

## Goals / Non-Goals

**Goals**
- One writer for stock: the `Stock` ledger, always accompanied by a `StockMovement`.
- The catalog's stock figure agrees with the figure checkout enforces.
- Existing rows are corrected, not left to drift silently.

**Non-Goals**
- Dropping the denormalized columns. They are load-bearing for the storefront and for sorting; the problem is who writes them, not that they exist.
- Adding an "opening stock" concept to product create. Considered and rejected below.
- Splitting product-level stock across variants for existing rows. The ledger records what was received; inventing a split would be fabricating history.

## Decisions

### Decision 1: Remove the field from the API rather than ignore it

The alternative was to keep accepting `stockQuantity` and silently drop it, which avoids breaking any client that still sends one. Rejected: a create that accepts a number, returns 201, and does not apply it is worse than one that never accepted it — the merchant has no way to tell the number was discarded, which is the same class of failure as the original bug.

Removing it from the zod schema is sufficient to make it unreachable, not merely undocumented. `validateRequest` replaces `req.body` with the parse result, and only the *query* schema in this module is `looseObject`, so an unknown key is stripped rather than passed through to the service's `...rest` spread. Verified directly: create, update, and nested variant payloads all drop a submitted `stockQuantity`.

### Decision 2: The product total counts variant stock

`applyDenormalizedStockDelta` was an either/or — variant movements updated `ProductVariant.stockQuantity`, product-level movements updated `Product.stockQuantity`, and neither updated the other. A variable product's own total was therefore never maintained by any ledger movement; it held whatever a merchant last typed, forever.

This was invisible while the catalog authored the number. Removing that without addressing it would have left every variable product's total at 0 — and the storefront derives `inStock` from exactly that field (`product.ts`: `inStock: product.stockQuantity > 0`), and `ProductCard` disables Add to cart on it. The visible result would have been every variable product reading "Out of stock" regardless of its ledger.

So the product total is now defined as *everything held for the product, including stock held against its variants*, and a variant-scoped movement credits both. The alternative — deriving the product total on read as a sum over its variants — was rejected because it reintroduces exactly the aggregate the column exists to avoid, and because product-level and variant-level `Stock` rows legitimately coexist (live data has a VARIABLE product whose stock is held on variant-less rows).

### Decision 3: Checkout's deduction had to change with it

Checkout does not call `applyDenormalizedStockDelta`; it deducts via batched raw SQL for latency reasons, and carried its own copy of the same either/or split. Fixing only the shared helper would have made receiving credit both totals while selling debited only one — a variable product's total would then climb with every sale. The two paths are now symmetric, and the comment at each site points at the other.

This is the failure mode worth naming: the bug was not that one function was wrong, but that the rule "what does the product total mean" was implicit and each writer guessed. It is now stated at both writers.

### Decision 4: No "opening stock" on create

The tempting middle path is to keep the field and have create write a `Stock` row plus an `ADJUSTMENT` movement — a real opening balance. Rejected for this change:

- It needs a warehouse, and create has no warehouse to write to. Picking a default silently attributes physical goods to a location the merchant did not choose.
- It duplicates a flow that exists and is better: receiving a purchase order records *where the units came from*, at what cost, from which supplier. An opening adjustment records none of that, so the supplier ledger, cost basis and profit reporting are all left guessing.
- The merchant already has stock adjustment for genuine corrections, and it already writes a movement.

The cost is real and should be stated: creating a product no longer makes it sellable in one step. That is the intended trade — it was already true at checkout, which is the only place that matters to a customer.

### Decision 5: The admin shows stock read-only rather than hiding it

"How many are there?" is a reasonable question to ask on a product page, and the answer was already displayed there. Removing the number entirely would have made the change feel like a regression. Both the product Inventory card and the variant editor's Stock column keep showing the figure and say where it comes from.

Implementation note: the product-level display is a plain `<div>`, deliberately **not** an antd `Form.Item`. antd injects `value`/`onChange` into a `Form.Item`'s child and registers it as a field; wrapping a non-field in one is a runtime hazard, and it is not a form field — nothing here submits.

### Decision 6: The backfill assigns, and writes no movements

`scripts/backfill-stock-mirror.ts` sets each mirror to the summed `Stock.quantity` held for it, rather than applying a delta. Assignment is idempotent — a second run over unchanged data is a no-op — and it is the only correct operation when the starting value is known-wrong rather than merely stale.

It writes no `StockMovement` rows. Nothing moves: no stock is created or destroyed, the ledger is already correct and is not touched. Writing movements here would put fictional PURCHASE/ADJUSTMENT events into an audit trail whose value depends on every row corresponding to something that actually happened.

## Risks / Trade-offs

**A product created today is not sellable until stock is received.** Intended, and already true at checkout. The admin now says so instead of implying otherwise.

**Product-level stock on a variable product stays product-level.** Live data has 96 units of a VARIABLE product held on variant-less rows, because the purchase order did not name a variant. The backfill reports that faithfully — product total 96, variants 0 — rather than dividing it. A merchant who wants it attributed per variant can adjust stock, which records the decision as a movement. The alternative, splitting it evenly, would invent inventory that was never received in that shape.

**The mirrors can still drift in principle**, since they are a cache maintained by four writers rather than a derived value. That was true before this change. What changes is that all writers now agree on the rule, and `scripts/backfill-stock-mirror.ts` is a repeatable reconciliation — the stock report's existing "cached quantity does not match on-hand" column remains the detector.
