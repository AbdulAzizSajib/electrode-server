## 1. Schema and migration

- [x] 1.1 Add `unitCost Decimal? @db.Decimal(12, 2)` to `prisma/schema/OrderItem.prisma`, documented as the cost basis snapshotted at placement — nullable because a null means "cost unknown", never zero (design Decision 6). Note in the comment that it is supplier cost and is excluded from customer-facing projections.
- [x] 1.2 Add a doc comment to `Product.purchasePrice` in `prisma/schema/product.prisma` and to `ProductVariant.purchasePrice` in `prisma/schema/productVariant.prisma` recording that it is now a cost basis maintained by purchase-order receipts, that an authored value is the opening cost, and that receipts overwrite it (design Decision 2).
- [x] 1.3 Run `npm run migrate` to generate the additive migration, and confirm it is a single nullable `ADD COLUMN` with no backfill or default. **Generated with `--create-only` and hand-corrected**: Prisma again emitted three `DROP INDEX` statements for the pg_trgm GIN indexes (the recurring drift documented in every migration since `20260831000000_add_product_search_indexes`). Removed them, applied with `migrate deploy`, and verified all three indexes survive and the column is `numeric NULL`.

## 2. Cost arithmetic (pure, no Prisma)

- [x] 2.1 Create `src/app/module/purchase-order/purchase-order.cost.ts` exporting `allocateLandedUnitCosts({ items, shippingCost, taxAmount })` → a `Map<purchaseOrderItemId, number>`. Allocate `shippingCost + taxAmount` pro-rata by line value (`quantity × unitCost`), divide by line quantity, round to 2 dp (design Decision 3).
- [x] 2.2 In the same file, handle the degenerate inputs the spec names: total line value of 0 falls back to bare `unitCost`, and a line with quantity 0 contributes no allocation and is skipped rather than dividing by zero.
- [x] 2.3 In the same file, export `weightedAverageCost(onHandBefore, existingCost, receivedQuantity, landedUnitCost)` returning a 2-dp number, with `existingCost == null || onHandBefore <= 0` returning `landedUnitCost` unchanged (design Decision 4).

## 3. Cost-basis write-back on receipt

- [x] 3.1 In `receivePurchaseOrder` (`purchase-order.service.ts`), call `allocateLandedUnitCosts` once before the `$transaction`, using the loaded purchase order's items, `shippingCost` and `taxAmount`.
- [x] 3.2 Inside the transaction, for each receipt line: read `onHandBefore` from `ProductVariant.stockQuantity` when `item.variantId` is set, otherwise `Product.stockQuantity` — **before** the existing `StockService.applyDenormalizedStockDelta` call for that line (design Decision 4; the ordering is load-bearing).
- [x] 3.3 Compute the new basis with `weightedAverageCost` and update `purchasePrice` on the variant when the line names one, otherwise on the product, in the same transaction as the stock increase and `StockMovement`.
- [x] 3.4 After the transaction commits, alongside the existing `StockService.notifyIfLowStock` loop, notify when the new cost basis is at or above the item's current `offerPrice` — the receipt itself must not fail (design Decision 7, `api/inventory` spec).

## 4. Cost snapshot at order placement

- [x] 4.1 Add `unitCost?: number | null` to `IOrderItemData` in `order.interface.ts`.
- [x] 4.2 In `order.service.ts`, in the checkout line loop next to where `unitPrice` is read, capture `unitCost` from `item.variant?.purchasePrice ?? item.product.purchasePrice`, coerced to a number or left null. Confirm `loadPayloadLines` selects `purchasePrice` on both product and variant — the cart path already loads whole rows (design Context).
- [x] 4.3 Grep the order read paths for the customer-facing item projections and confirm `unitCost` is not included in any of them; exclude it explicitly where the projection spreads the row (`api/checkout` spec). **Leak found and closed**: `ORDER_DETAIL_INCLUDE` uses `items: true`, so `unitCost` rode along on checkout, guest tracking, customer order detail and self-cancel. Added `withoutItemCosts` and applied it at those five boundaries; staff reads keep the field.

## 5. Verification

- [x] 5.1 Create `scripts/verify-cost-basis.ts` following the shape of `scripts/verify-supplier-payments.ts` (marker-prefixed fixtures, cleanup in a `finally`, `PASS`/`FAIL` lines, non-zero exit on failure). Cover the happy paths only: the two-line landed-cost allocation from the `api/inventory` spec, a weighted-average receipt (10 @ 90 + 10 @ 110 → 100), a first receipt onto a null cost basis, and a variant-scoped line updating the variant and not its product.
- [x] 5.2 Add one order-placement check to the same script: place an order for a product with a known cost basis, assert `OrderItem.unitCost` matches, then receive a purchase order that moves the basis and assert the placed order's `unitCost` is unchanged.
- [x] 5.3 Add `"verify:cost-basis": "tsx scripts/verify-cost-basis.ts"` to `package.json` scripts and run it green.
- [x] 5.4 Run `npm run verify:postman` and `npm run lint`. No endpoints or request bodies change, so the Postman collection is expected to need no edit — confirm rather than assume. **Confirmed, and both surfaced PRE-EXISTING failures unrelated to this change, left untouched:** `verify:postman` reports `GET /backup/export`, `POST /backup/restore`, `POST /backup/restore/confirm` mounted but undocumented; `lint` reports one error, an unused `shippingAddress` binding at `order.service.ts:677`. Both verified against `dist/` (built Sep 5, before this change). Nothing in the files this change touched is flagged.
