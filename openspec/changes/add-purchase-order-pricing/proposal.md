## Why

A purchase order line asks for a unit cost and offers no help answering it. The form opens with `0`, and the merchant types a figure from memory or from a supplier invoice in another window — even though the product already records a `purchasePrice`, which since `add-weighted-average-cost-basis` means exactly "what the stock on hand cost". The number they need is one field away and the form does not show it.

The second half is worse, because it is silent. A shipment arriving at a higher cost is the moment a selling price needs revisiting, and the purchase order is where the merchant learns the new cost. But the prices live on the product form, so the reprice is a separate trip to a separate screen — often days later, often not at all. Meanwhile the receipt has already moved `purchasePrice` up, and the catalogue is quietly selling at a margin nobody chose. The system even detects this: `receivePurchaseOrder` already warns when a receipt prices an item at or above its offer price. It warns, and then the merchant has to go somewhere else to act on it.

So: put the three prices a merchant already authored on the product in front of them while they are costing the order, and let them set the new selling price in the same place they discover the new cost.

## What Changes

- **Unit cost defaults to the product's `purchasePrice`.** Choosing a product (or a variant) on a line fills Unit cost with its current cost basis, in the same line-item row, from the product the admin form already loads. A variant's own cost is preferred over its parent's, matching how the receipt values it. It is a default, not a lock — the merchant overwrites it with what the supplier actually charged, which is what `unitCost` means.
- **Each line reports the product's three prices** — Purchase, Offer, Regular — so the merchant can see what this shipment does to the margin without leaving the page.
- **Offer and Regular price are editable on the line**, and a line may carry a *staged* new price for each. Staging records a proposal on the line; it does not write to the product.
- **Staged prices are applied on goods receipt**, in the same transaction that moves the cost basis and the stock ledger. That is the one moment a purchase order is allowed to change a product, and it is already that moment for `purchasePrice`. A draft, an amended line or a cancelled order therefore never touches the live catalogue.
- **Pricing helpers, to compute a staged price rather than type one:**
  - **markup on the line's unit cost** — "cost + 25%" — the figure that actually answers "what should I sell this at now";
  - **fixed-amount adjustment** — "+50", "−30" — against the price currently in the field.
  Both write into the same staged-price fields, so a helper is a way to fill them in and never a second source of truth.
- **The receipt's existing below-cost warning gains the staged prices**, so a merchant who staged a price that is still under the new landed cost is told at the same moment as one who staged nothing.
- **`PurchaseOrderItem` gains two nullable staged-price columns** (`stagedOfferPrice`, `stagedSellingPrice`). Nullable is load-bearing: null means "this line has no opinion about the selling price", which is what every existing row means and what an untouched line keeps meaning.
- **BREAKING for a merchant in one way, stated plainly:** a purchase order can now change a product's customer-facing prices. It could only change cost before. The change is confined to receipt, is recorded on the receipt's audit entry, and is visible on the line before it happens — but it is a new power, and a merchant who stages a price by accident and then receives the order has repriced their storefront.

Stated because their absence is deliberate:

- **No immediate write on save.** Rejected explicitly — design.md Decision 2. A draft order would reprice a live storefront before any goods existed.
- **No blocking a receipt on a bad margin.** The goods have arrived; refusing to record them would leave the ledger wrong about physical stock. The existing warn-don't-block rule is kept and extended, not replaced.
- **No automatic reprice.** A helper computes a price only when the merchant asks; nothing derives a selling price on its own, and no default markup is applied to a line the merchant left alone.
- **No `purchasePrice` editing on the line.** It is a derived cost basis now — the receipt computes it as a weighted average over landed cost. A line already sets it, through `unitCost`. A second, direct control would be two inputs for one number.
- **No price history.** The receipt's audit entry records the price it applied; there is no per-product price timeline, and this change does not start one.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `api/inventory`: purchase order lines report the ordered item's current prices and may stage new selling prices; a goods receipt applies staged prices in the transaction that moves cost and stock; the receipt's below-cost warning accounts for staged prices; two pure pricing computations are offered for filling a staged price. Sits alongside the requirements `add-weighted-average-cost-basis` adds to this capability — that change is still unarchived, so these are ADDED requirements rather than modifications of its text.
- `api/catalog`: a goods receipt becomes an authorised writer of `offerPrice` and `sellingPrice`, and the loss guard that refuses an offer price at or below cost on the product form is not applied to that path. Also ADDED for the same reason.

## Impact

- **server** — `prisma/schema/PurchaseOrderItem.prisma` (two nullable `Decimal(12,2)` columns) and one migration; `purchase-order.validation.ts` (staged prices on create and amend); `purchase-order.service.ts` (the read projection reports current prices; `receivePurchaseOrder` applies staged prices inside the existing transaction; the post-commit warning reads them); `purchase-order.interface.ts`. `purchase-order.cost.ts` gains the two pure helpers so they are unit-testable without a database, and `scripts/verify-cost-basis.ts` covers them. **No change to how `purchasePrice` is computed.**
- **admin** — `src/lib/api/purchase-orders.ts` (staged prices and reported prices on the line types); `src/features/inventory/purchase-orders/purchase-order-form-page.tsx` (the cost default, the three prices, the staged inputs and the helpers — the form already resolves each line's product via `useProduct`, so no new query); `purchase-order-detail-page.tsx` (staged prices on a line awaiting receipt); `purchase-order-form-page.test.tsx`.
- **Migration** — additive and nullable, so no backfill. Every existing row reads as "no staged price", which is exactly what it means. **The trigram-index `DROP INDEX` lines must be removed from the generated migration** (root CLAUDE.md) and the NOTE block carried forward.
- **Ships server-first.** The admin cannot stage a price the API will not accept; the server accepting a field no client sends yet is inert.
