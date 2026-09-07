Implementation checklist for `add-admin-correction-paths`. Each numbered group is independently implementable/archivable.

Groups are ordered by severity: 1-3 are silent data/money corruption, 4-6 are visible-but-blocking, 7 is cleanup. Within each group the guard and its correction path ship together — a guard alone strands the rows already written, and a correction path alone lets the mistake recur (design.md Decision 6).

Requirements are in `specs/api/{checkout,post-purchase,inventory}/spec.md`; the technical decisions behind these steps are in `design.md`.

## 0. Schema groundwork

Additive and deployable ahead of everything else, so no later group waits on a migration.

- [x] 0.1 Add a `StockMovementType` value for a cancellation reversal (design.md Decision 2 — `ADJUSTMENT` means a human recounted, `RETURN` means goods came back from a customer; a cancellation is neither). Migration only; nothing writes it until 2.1.
- [x] 0.2 Confirm nothing switches exhaustively over `StockMovementType` in a way the new value breaks — the type checker surfaces this. No exhaustive switch exists, but four allow-lists enumerate the type and each silently mishandles an unlisted value: `INBOUND_TYPES` in `report.stock-history.ts` (an unlisted type is counted as OUTBOUND, breaking the in/out reconciliation), the report's `type` filter enum in `report.validation.ts`, and the two duplicated unions in the admin (`lib/api/stock-movements.ts`, `lib/utils/stock-movement-labels.ts`). All four updated.

## 1. Returns: stop the double restock, reconcile the two completion paths

The admin UI currently guides the operator into this one, so the guard is the priority.

- [x] 1.1 `return.service.ts#updateReturnStatus`: validate the transition. `COMPLETED` and `CANCELLED` are terminal; define the legal predecessors for each remaining status and reject anything else with a message naming the attempted transition. The existing `existing.status !== COMPLETED` restock guard (`return.service.ts:212`) stays as defence in depth. Added `RETURN_STATUS_TRANSITIONS` + `assertReturnTransitionAllowed`.
- [x] 1.2 `admin/src/features/sales/returns/return-detail-page.tsx`: the "Set status" dialog offers every `ReturnStatus` unconditionally (`:99-105`, `:160-162`). Offer only the transitions 1.1 permits from the current status, so the UI cannot compose a request the backend will reject. The detail read now returns `allowedTransitions` from the same map the guard enforces, and every action button plus the dialog's option list derives from it — restating the list client-side is what caused the bug.
- [x] 1.3 Reconcile the two paths to `COMPLETED`. Added `restockWarehouseId` to the refund payload: supplying it restocks through the *same* `restockReturnedItems` the direct path uses, omitting it records a refund for goods the customer keeps. `restockCompletedReturn` was refactored to take a transaction client so both paths share one implementation — two copies of "what completing a return does to stock" is how they came to disagree.
- [x] 1.3a **Found while implementing**: the direct path committed the restock in its own transaction and then updated the status separately, so a failure in between left stock added but the return not `COMPLETED` — re-completable, restocking again. Both writes now commit together.
- [x] 1.4 Report script: `scripts/report-return-restock-drift.ts` — finds returns `COMPLETED` with no `RETURN` movement (never restocked) and those with more movement rows than items (restocked twice). Read-only. Clean against current data.
- [x] 1.5 Verify script: `scripts/verify-return-transitions.ts`, 10 checks — restock happens exactly once, terminal statuses reject both the move back and the re-completion, the refused attempts add no stock, and the two refund paths restock or not as the caller stated.

## 2. Order cancellation: return the stock

- [x] 2.1 `order.service.ts`: on a transition to `CANCELLED` from a pre-fulfilment status, restock each line in the same transaction — increment `Stock.quantity` at the warehouse the deduction came from, call `applyDenormalizedStockDelta`, and write a `StockMovement`. Applies to both `updateOrderStatus` and `cancelOwnOrder`. Added `restockCancelledOrder`.
- [x] 2.1a **Design detail found while implementing**: the warehouse cannot be chosen by the restock. `deductStockForOrderLines` splits one line across several warehouses when no single one covers it, and only the order's own `SALE` movements record how it actually split — so the restock reads those back and returns each part to the shelf it came from. Picking a warehouse would move stock between buildings on paper. `verify-order-cancel-restock.ts` forces a 5+3 split across two warehouses and asserts each one individually, because returning the right *total* to the wrong shelf passes a total-only check.
- [x] 2.2 Write the reversal with the movement type added in 0.1, and make the restock idempotent — nets `SALE` against `CANCELLATION` per (product, variant, warehouse) and returns only what is still outstanding, so it is safe independently of 3.1's guard.
- [x] 2.3 Cancelling a *fulfilled* order is not a restock — handled by 3.1's transition map, which does not offer `CANCELLED` from `SHIPPED`/`DELIVERED`. `RESTOCKABLE_ON_CANCEL_STATUSES` is a second check inside the transaction.
- [x] 2.4 Report script: `scripts/report-cancelled-order-stock.ts` — nets `SALE` against `CANCELLATION` per cancelled order and lists what is still deducted. Read-only. Clean against current data.

## 3. Order status: constrain the transitions

- [x] 3.1 `order.service.ts#updateOrderStatus` validates only that the status differs (`:1288`). Added `ORDER_STATUS_TRANSITIONS` + `assertOrderTransitionAllowed`; `CANCELLED` and `COMPLETED` are terminal. The staff detail read returns `allowedTransitions`, and the admin's status dialog and Cancel button derive from it rather than listing every status — the same fix as returns, and for the same reason.
- [x] 3.2 Audit `totalSold` for double-counting across the refund and payment-status paths.

  **The predicted double-count does not exist.** The proposal and design.md Decision 4 asserted that an admin correcting a `REFUNDED` payment back to `PAID` would double-count against the refund's own decrement. It does not: `createRefund` guarded its decrement with `refundedPayment.status === PaymentStatus.PAID`, and `updatePaymentStatus` keys off the `wasPaid -> isNowPaid` transition. Both were already idempotent for that sequence.

  Verified rather than assumed: reverting the refactor and re-running `scripts/verify-total-sold-idempotence.ts` still passes all six checks, and a rule-by-rule comparison over every (from-status, full/partial) pair shows the old and new decrement conditions are behaviourally identical while `PAID_PAYMENT_STATUSES` has one member.

  The refactor is kept anyway, as a structural guard rather than a bug fix: `createRefund` wrote `Payment.status` directly while applying its own delta, so the two rules had to be kept in agreement by hand in two files. `applyTotalSoldForPaymentTransition` now owns the rule, and the refund path routes through it — so adding a second value to `PAID_PAYMENT_STATUSES` (the comment there anticipates one) cannot silently make them diverge. Downgraded from a fix to hardening; the spec requirement it was written against is unaffected either way.

- [x] 3.2a `scripts/backfill-total-sold.mjs` still reconciles after the change — dry run reports no drift. It recomputes absolutely rather than applying deltas, so it remains the repair procedure.
- [x] 3.2b Verify script: `scripts/verify-total-sold-idempotence.ts`, 6 checks covering pay -> refund -> correct-to-PAID -> refund again -> replay, asserting at every step rather than only at the end.

## 4. Refunds: void and amend

- [x] 4.1 `createRefund` must record what it is about to overwrite. **Not the audit log**: `AuditLogService.record` swallows its own write failures by design, so an entry is not guaranteed to exist and a void relying on it would sometimes guess. Added `priorPaymentStatus`, `priorReturnStatus` and `completedReturnRequestId` columns to `Refund` (migration `20260907150000_add_refund_prior_state`, additive and nullable, deliberately not backfilled — for older refunds the prior statuses are genuinely unknown).
- [x] 4.2 `PATCH /refunds/:refundId` and `PATCH /refunds/:refundId/void`, OWNER/ADMIN only — narrower than the STAFF who may issue a refund, since voiding reverses a payment status, a return's completion and a sold count in one step. `PATCH .../void` rather than `DELETE`: the row is kept and marked `CANCELLED`, because a refund that existed is a thing that happened and the payments report has already shown it.
- [x] 4.3 Voiding unwinds everything creation did, in one transaction, restoring each record to what it *was* from 4.1's columns. Verified against both traps: a return already `COMPLETED` for its own reasons is not reopened, and a payment refunded from `PENDING` does not come back as `PAID`.
- [x] 4.4 Amending re-runs the over-refund guard with the amended row excluded from the comparison, following `supplier-payment.service.ts`'s `excludePaymentId` shape. Only `amount`/`reason` are amendable — changing which payment or return a refund covers would leave the recorded prior state describing records it no longer touches, so that is void-and-reissue.
- [x] 4.5 Audit-logged: create, amend and void.
- [x] 4.6 `admin/src/lib/api/refunds.ts` comment updated (it documented the absence as deliberate), `useUpdateRefund`/`useVoidRefund` added, and the refunds page's detail dialog now offers "Save amount" and "Void refund" with the consequences stated. Voiding invalidates orders/returns/products too, since it moves all three.
- [x] 4.7 Verify script: `scripts/verify-refund-void-amend.ts`, 11 checks — the full unwind, both restore-what-was traps, exclude-self amendment, and the refusals (double void, over-refund, amending a voided refund).

## 5. Coupons: correct the usage count

Derive rather than store, per design.md Decision 3 — `perCustomerLimit` is already derived (`coupon.service.ts:194-201`) while the global limit reads the stored counter (`:190`), so the two disagree by construction on every cancellation.

- [x] 5.1 Replaced the `usageCount >= usageLimit` check with `countCouponRedemptions`, which both limits now share — so the same event cannot mean two different things depending on which rule is asking.
- [x] 5.2 Measured before committing. **The index did not exist**: `Order` had no index on `couponCode`, so the per-customer count was carried by the `customerId` index while a global count would have sequentially scanned every order ever placed. Added `[couponCode, status]` (migration `20260907160000`). Built without `CONCURRENTLY` deliberately — Prisma wraps migrations in a transaction and PostgreSQL refuses it there, so the migration would fail outright rather than merely lock; the tradeoff and the manual escape hatch are documented in the migration.
- [x] 5.3 Column kept, and explicitly marked deprecated-as-a-source-of-truth in `Coupon.prisma` with the reason and a note to drop it. It is still incremented so a rollback has a moving counter, but nothing reads it to decide anything.
- [x] 5.3a **Found while implementing**: the admin *displays* `usageCount`. Leaving it would have shown a merchant a coupon reading 100/100 that still redeems — the drift made visible rather than fixed. `getAdminCoupons` now reports the derived figure under the same field name, via one grouped query per page.
- [x] 5.4 Report script: `scripts/report-coupon-usage-drift.ts` — compares stored against standing per coupon, and distinguishes the expected direction (cancellations inflating the counter) from the surprising one (orders the counter never saw). Read-only. Clean against current data.
- [x] 5.5 Verify script: `scripts/verify-coupon-usage-derived.ts`, 6 checks driven through the real enforcement path — including the decisive case where the stored counter reads 2 of 2 while only one order stands, and the redemption is correctly allowed.

## 6. Purchase orders: amend an unreceived line

- [x] 6.1 Added `PATCH /purchase-orders/:id/items` (`amendPurchaseOrderItems`) rather than widening `PATCH /:id`, per design.md Decision 1 — the two have opposite shapes: the scalar endpoint refuses every edit once receiving begins, while this one stays available precisely *because* what it changes has not yet arrived. Lines are amended down to, never below, `receivedQuantity`; only a line that received nothing may be removed; new lines may be added.
- [x] 6.1a The whole amendment runs in one transaction against a **re-read** of the line quantities. A receipt landing between the check and the write would otherwise let an amendment composed against stale quantities overwrite it.
- [x] 6.2 `subtotal`/`totalAmount` recomputed on amendment, which is what lifts the payment ceiling. Also guards the other direction: an amendment that would take the total below money already recorded as paid is refused, the same hazard `assertNoSupplierPayments` covers on cancellation.
- [x] 6.2a The order's status is recomputed too — amending the outstanding quantity down to what has arrived settles the order to `RECEIVED`, since the status is a consequence of the quantities rather than a fixed value.
- [x] 6.3 Refused with the received figure named: *"Cannot reduce this line to 3 — 4 unit(s) have already been received against it"*.
- [x] 6.4 Admin UI: line items are now editable on an existing order (read-only only when cancelled). Added a read-only "Received" column so the immutable part is visible, set each quantity input's `min` to what has arrived, and disabled removal on a line with receipts, with the reason in its tooltip. The form sends the amendment first and skips the scalar update entirely when the backend would refuse it — otherwise a successful amendment would be reported as a failed save.
- [x] 6.5 Verify script: `scripts/verify-purchase-order-amend.ts`, 11 checks — amendment after a partial receipt, both refusals, the settle-on-amend status, and the payment-ceiling sequence (payment rejected → amend total up → same payment accepted → amendment below paid money refused).
- [x] 6.6 Two admin tests added for the received-order path: line items still amend through their own endpoint, and the remove button is disabled on a line with receipts. One existing test updated — it asserted the scalar update fires on a `RECEIVED` order, which is now deliberately skipped.

## 7. Shipments: clear a wrong timestamp

- [x] 7.1 `shipment.validation.ts`: `shippedAt`/`deliveredAt` are now `.nullable().optional()`, so an omitted field and an explicitly cleared one are different requests.
- [x] 7.2 `shipment.service.ts`: replaced the `value ? new Date(value) : undefined` collapse with a three-case mapping — absent leaves alone, null clears, a date sets. Interface widened to `string | null`.
- [x] 7.2a Admin UI: **nothing to change**. The order detail page's shipment form never exposed these timestamps, so there was no control that could compose a clear. The backend fix is what makes adding one possible; doing so is ordinary feature work rather than part of this correction, and no data is stranded meanwhile.
- [x] 7.3 **Split out, not done here.** A second shipment per order is a real gap — `getLatestShipment` and the create conflict both assume one, so a genuine two-parcel delivery cannot be recorded. But it is a data-model change (shipments would need to own their line items to say *what* was in each parcel), not a correction path, and nothing about it is unrecoverable today: the merchant is blocked with a clear error rather than left holding silently wrong data. Out of scope for this change by design.

## 8. Cross-cutting

- [x] 8.1 Every correction endpoint writes an `AuditLog` entry. Audited the modules rather than assuming: `refund` (create/amend/void), `purchase-order` and `stock` already had them, but **`order.service.ts` and `return.service.ts` had none at all** — and both now move stock, which is precisely what a later reconciliation needs to explain. Added to `updateOrderStatus`, `cancelOwnOrder` (attributed to the customer's own user) and `updateReturnStatus`; the last two required threading `userId` through their controllers.
- [x] 8.2 Verify script per group, all following `verify-stock-reassign.ts`: `verify-return-transitions` (10), `verify-order-cancel-restock` (11), `verify-total-sold-idempotence` (6), `verify-refund-void-amend` (11), `verify-coupon-usage-derived` (6), `verify-purchase-order-amend` (11). 65 checks including the original 10. Each seeds with a marker prefix and cleans up in a `finally`; all re-run green after the group 8 changes.
- [x] 8.3 Surfacing, per condition — **the honest split**:
  - **Done where a backlog can exist.** Stranded stock keeps its flag/banner/"Fix variant" affordance. Refunds now carry amend and void in the detail dialog with the consequences spelled out. Purchase-order lines are editable with a read-only "Received" column showing what cannot change. Return and order status controls offer only legal transitions, so the illegal ones are not merely refused but unreachable.
  - **Not needed by design.** The remaining conditions cannot accumulate a backlog to surface: order-cancel restock, coupon usage and the return/refund completion split are now correct at the point of writing, and their four report scripts (`report-variantless-stock`, `report-return-restock-drift`, `report-cancelled-order-stock`, `report-coupon-usage-drift`) all run clean against current data. Building a permanent admin banner for a condition with no instances would be surfacing nothing.
- [x] 8.4 `report-variantless-stock` refined: a reassignment leaves the source row present holding zero, and the report was still listing it as a problem. Now filtered to `quantity > 0`, so a completed repair stops being reported.
