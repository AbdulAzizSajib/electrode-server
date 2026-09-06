## Why

Stock has two writers that do not know about each other, and they disagree.

The `Stock` ledger — a row per (warehouse, product, variant), every change accompanied by a `StockMovement` — is what checkout reads. Purchase-order receiving, stock adjustment, return restocking and checkout deduction all go through it, so every unit it holds can be traced to the event that put it there.

Product create and update bypassed it entirely. They accepted a `stockQuantity` and wrote it straight onto `Product.stockQuantity` / `ProductVariant.stockQuantity` — the denormalized mirrors of that ledger — creating no `Stock` row and no `StockMovement`. A merchant typing 100 into the product form produced a product the catalog advertised as having 100, backed by nothing.

The two numbers are read by different code, so the split surfaced as a customer-facing failure: the storefront reads the mirror and offers Add to cart, checkout reads the ledger and rejects the order. `add-checkout-and-addresses/design.md` already recorded the symptom — "the `Stock` ledger is empty (0 rows) while `Product.stockQuantity` reads 20–75 ... every product currently 409s" — and treated it as missing data. It is not missing data; it is a second writer.

Live data confirms both halves. Of two products: one advertised 50 units against a ledger holding **0** (pure phantom stock, uncheckoutable), the other advertised 196 against a ledger holding **96** — the 100 typed at create, plus 96 genuinely received through a purchase order.

A second defect was hidden underneath. `applyDenormalizedStockDelta` updated *either* the variant total *or* the product total, never both, so a variable product's own `stockQuantity` was never maintained by any ledger movement — it only ever held whatever a merchant typed. Removing the typed value without fixing this would have left every variable product reading 0 and showing "Out of stock" on the storefront, which derives `inStock` from that field.

## What Changes

- **`stockQuantity` is removed from the product create/update API**, at both product and variant level. `validateRequest` replaces the body with the parsed result, so an omitted field is stripped rather than merely ignored — a hand-crafted request cannot smuggle it through to the service's `...rest` spread.
- **`toVariantData` no longer writes `stockQuantity`.** A new variant starts at the column default of 0; an existing variant keeps whatever the ledger has put there, so a catalog edit can no longer overwrite a real quantity.
- **`applyDenormalizedStockDelta` maintains the product total for variant-scoped movements too.** The product total is the sum of everything held for the product, so a variant receipt now credits both the variant and its product. This is what keeps variable products visible on the storefront once the catalog stops authoring their totals.
- **Checkout's deduction mirrors the same rule.** It deducts via batched raw SQL rather than the shared helper, and had the identical either/or split; every line now decrements its product total, not only variant-scoped lines their variant. Without this, receiving would credit both while selling debited one, and a variable product's total would climb forever.
- **The admin form shows stock read-only** instead of accepting it — on the product's Inventory card and in the variant editor's Stock column — and says where stock actually comes from. The field is not merely disabled: the write path is gone from the payload.
- **A one-time backfill resets both mirrors to the ledger.** `scripts/backfill-stock-mirror.ts` assigns each total the summed `Stock.quantity` actually held for it, correcting inflated values and populating variable-product totals that were never maintained.

`lowStockThreshold` stays editable in the catalog. It is a setting — when to warn — not a quantity, and no ledger owns it.

## Capabilities

### New Capabilities
<!-- None. This narrows an existing capability: stock authorship moves out of `api/catalog` and is left solely to `api/inventory`, which already governs it. -->

### Modified Capabilities
- `api/catalog`: Admin catalog management no longer accepts a stock quantity on product or variant create/update. The catalog describes what is sold; it does not assert how many exist.
- `api/inventory`: The denormalized product total is specified as the sum of everything held for a product, including stock held against its variants, and is maintained by every `Stock`-changing path.

## Impact

**No schema change, no migration.** `Product.stockQuantity` and `ProductVariant.stockQuantity` are retained — they are the mirrors that make the storefront's reads and the catalog's "sort by stock" possible. What changes is who is allowed to write them.

**Behavioral change worth stating plainly:** a newly created product now has 0 stock and is not sellable until a purchase order is received against it. That is the intended outcome — it is also what was already true in the ledger, and therefore already true at checkout. The change makes the catalog agree with it rather than advertising a number that checkout would reject.

**Data:** run `npx tsx scripts/backfill-stock-mirror.ts` (supports `--dry-run`). It writes no `StockMovement` rows because no stock moves — the ledger is already correct and untouched; only the cached copies of it change. Safe to run repeatedly: it assigns an absolute value, not a delta.

**Stock held product-level on a variable product stays that way.** Existing rows record receipts made without naming a variant, and the backfill does not invent a variant split for them — it reports what the ledger holds. Attributing that stock to specific variants is a merchant decision, made by adjusting stock, not something a migration can infer.

**Clients:** `ProductInput` / `ProductVariantInput` drop the field in `electrode-admin`. Read-side types keep it — the value is still returned and still read by the storefront and admin listings.
