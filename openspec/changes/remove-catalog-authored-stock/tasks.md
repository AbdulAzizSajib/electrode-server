## 1. Remove stock authorship from the catalog API

- [x] 1.1 Drop `stockQuantity` from `productVariantZodSchema` and from `createProductZodSchema` in `product.validation.ts`. Comment both against design Decision 1 so a future reader does not "restore" them. Keep `lowStockThreshold` — it is a setting, not a quantity.
- [x] 1.2 Drop `stockQuantity` from `IProductVariantInput` and `ICreateProductPayload` in `product.interface.ts`, leaving a pointer to the validation file.
- [x] 1.3 Remove `stockQuantity` from `toVariantData` in `product.service.ts`, noting that a new variant starts at the column default and an existing one keeps what the ledger put there.
- [x] 1.4 Verify the field is genuinely unreachable, not merely undocumented: `validateRequest` replaces `req.body` with the parse result, so an unknown key is stripped before the service's `...rest` spread. Confirmed only `publicProductQueryZodSchema` is `looseObject`; parsed a create payload carrying `stockQuantity` at both product and variant level plus an update payload — all three stripped.

## 2. Make the denormalized totals mean one thing

- [x] 2.1 Change `applyDenormalizedStockDelta` (`stock.service.ts`) from either/or to: update the variant total when the movement names a variant, and **always** update the product total. Document why against design Decision 2 — the previous either/or left every variable product's own total permanently 0.
- [x] 2.2 Apply the same rule to checkout's batched deduction in `order.service.ts`, which does not use the shared helper and carried its own copy of the split. Every line now decrements its product total; variant lines additionally decrement their variant. Cross-reference the two sites so they cannot drift apart again (design Decision 3).
- [x] 2.3 Confirm return restocking needs no change — `return.service.ts` routes through `applyDenormalizedStockDelta` and inherits the fix. Verified.
- [x] 2.4 Confirm purchase-order receiving needs no change — same helper. Verified.

## 3. Admin console

- [x] 3.1 Remove `stockQuantity` from `FormValues`, `EMPTY_VALUES`, the product-load mapping, and the submit payload in `product-form-page.tsx`.
- [x] 3.2 Replace the editable product stock field with a read-only display that states where stock comes from. Use a plain element, **not** a `Form.Item` — antd injects `value`/`onChange` into a Form.Item's child and registers it as a field, and this is not a field (design Decision 5).
- [x] 3.3 Make the variant editor's Stock column read-only, keeping the number visible.
- [x] 3.4 Stop sending `stockQuantity` in the variant payload; the row keeps carrying it for display and for carry-over when the attribute selection changes.
- [x] 3.5 Drop `stockQuantity` from `ProductInput` and `ProductVariantInput` in `lib/api/products.ts`. Leave the read-side `Product` / `ProductVariant` types alone — the value is still returned and still displayed.
- [x] 3.6 Typecheck (`tsc -b`) and run the test suite. Clean; 29 tests pass.

## 4. Backfill

- [x] 4.1 Write `scripts/backfill-stock-mirror.ts`: reset every product and variant total to the summed `Stock.quantity` held for it. Assignment rather than delta so it is idempotent; no `StockMovement` written because no stock moves (design Decision 6). Support `--dry-run`.
- [x] 4.2 Dry-run against live data and confirm it reports the expected corrections. Two products: one advertising 50 against a ledger holding 0, one advertising 196 against 96.
- [ ] 4.3 **Run it for real** — `npx tsx scripts/backfill-stock-mirror.ts`. Not yet applied: the write was declined by the sandbox, so this is left for the maintainer to run against the live database.

## 5. Verification

- [x] 5.1 Server typecheck. Clean — the one remaining error is a pre-existing `lib/auth.ts` better-auth signature mismatch, unrelated to this change and present before it.
- [x] 5.2 Confirm the ledger itself was never touched by any of this: `Stock` rows and `StockMovement` rows are read, summed and compared, never written outside the existing inventory paths.
- [ ] 5.3 Smoke-test the admin product form and a storefront product page after 4.3 has been run. Blocked on the backfill: until then the mirrors still hold their pre-change values, so what the storefront shows is not yet the post-change behaviour.
