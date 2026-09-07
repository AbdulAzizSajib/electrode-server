## Context

See proposal.md — Why, for the motivation and the eight audited findings.

What shapes the approach technically:

- **Two stock stores, one truth.** `Stock` (per warehouse/product/variant) is the ledger; `Product.stockQuantity` and `ProductVariant.stockQuantity` are denormalized mirrors the storefront reads. `applyDenormalizedStockDelta` (`stock.service.ts:26-54`) credits the variant mirror when the movement is variant-scoped and *always* credits the product mirror, because a product's total is the sum across its variants. Any new stock-moving path has to respect that asymmetry or it will double-count.
- **`StockMovement` is append-only.** Nothing in `stock.route.ts` edits or deletes a movement. Every correction therefore has to be expressible as a *new* movement.
- **Counters that cannot be un-drifted.** `applyTotalSoldDelta` (`payment.service.ts:46-86`) applies a blind signed delta and clamps the decrement at zero. Once clamped, the lost count is gone — it does not know what it failed to subtract. `Coupon.usageCount` has the same shape with no clamp.
- **One module already solves this problem correctly.** `supplier-payment.service.ts` has update *and* delete, re-runs its overpayment guard with `excludePaymentId` when amending (`:202-240`), and audit-logs both. Purchase-order settlement figures are computed on read rather than stored, and `purchase-order.service.ts:37-53` explicitly names `Product.stockQuantity` vs `Stock.quantity` as the drift it is avoiding. This change follows that module rather than inventing patterns.
- **The archetype is already implemented.** `reassignStockVariant` (`stock.service.ts`) plus the Stock page's flag/banner/fix affordance and `scripts/report-variantless-stock.ts` are the shape every group here repeats: guard, correction path, backlog report, visible signal.

## Goals / Non-Goals

**Goals:**

- Every correction in scope is reachable from the admin panel by the operator who caused it, without database access.
- Corrections conserve what they claim to conserve — stock moved not created, money unwound not doubled — and are provable by a verify script.
- Existing bad rows are findable, not just newly preventable.

**Non-Goals:**

- Rewriting history. `StockMovement` stays append-only; corrections compensate.
- A general "undo" facility. Each correction is a specific, guarded operation with its own rules.
- Warehouse deletion after movements exist — `isActive` already covers it (`warehouse.service.ts:84-92`).
- Multi-shipment orders (task 7.3), which is a data-model change, not a correction path.

## Decisions

### 1. Correction endpoints, not a general edit surface

Each correction is its own endpoint with its own guards (`POST`/`PATCH` per operation), rather than widening the update schemas to accept previously write-once fields.

*Why:* the fields in question are write-once for good reasons — a received quantity established a cost basis; a refund moved a payment's status. Making them freely writable would remove the guard along with the trap. A named operation can enforce "you may reduce this line, but not below what already arrived" in a way a permissive `PATCH` cannot. It also gives the audit log a meaningful action name instead of a diff.

*Alternative considered:* allow the fields in `update*ZodSchema` and validate inside the service. Rejected — the validation ends up conditional on which fields are present, which is how the existing all-or-nothing guards (`purchase-order.service.ts:236-244`) came to be written in the first place.

### 2. Reversals are new movements with a truthful type

A cancellation's restock writes a `StockMovement` whose type says "cancellation", not `ADJUSTMENT` and not `RETURN`.

*Why:* `ADJUSTMENT` means a human recounted the shelf; `RETURN` means goods came back from a customer. A cancellation is neither — the goods never left. The stock history is what an admin reads to explain a discrepancy, and overloading an existing type makes every future reconciliation ambiguous. This needs a new `StockMovementType` enum value and a migration.

*Alternative considered:* reuse `ADJUSTMENT` with a note. Rejected — notes are free text and not filterable; the movements report groups by type.

*Trade-off:* adding an enum value touches a shared type. It is additive, so existing rows and queries are unaffected.

### 3. Prefer deriving a counter over adding a way to repair it

For `Coupon.usageCount`, derive usage from standing redemptions rather than keeping a stored counter plus a new correction endpoint.

*Why:* the coupon module already derives the per-customer limit by counting non-cancelled orders (`coupon.service.ts:194-201`) while the global limit reads the stored counter (`:190`) — the two disagree by construction whenever an order is cancelled, and that is the bug. Deriving both makes the disagreement impossible instead of fixable. `purchase-order.service.ts:37-53` documents this exact reasoning for settlement figures.

*Alternative considered:* keep the counter, decrement on cancellation, expose an admin correction. Rejected as the primary approach — it adds a third place that must stay in sync, and the correction endpoint exists only to repair drift the design permits. Tasks 5.2/5.3 keep it as the fallback if measurement shows the derived read is too costly on the checkout path.

*Risk:* the redemption check runs on every checkout. Mitigated by an indexed count over `Order` filtered by coupon and status — the same query shape `perCustomerLimit` already runs there — and by measuring before committing (task 5.3).

### 4. `totalSold` deltas become idempotent per order, not more clamped

Rather than adding guards around the clamp, make each order contribute to `totalSold` at most once, so replaying a transition cannot double-count.

*Why:* the clamp at `payment.service.ts:74-84` is what makes drift *unrecoverable* — a blind decrement that hits zero has silently discarded the remainder. More clamping compounds that. The fix is upstream: if the delta cannot be applied twice, the clamp is never reached in the first place.

> **Corrected during implementation (task 3.2).** The double-count this decision was written to fix does not exist. `createRefund` already guarded its decrement with `refundedPayment.status === PaymentStatus.PAID`, and `updatePaymentStatus` already keyed off the `wasPaid -> isNowPaid` transition — so correcting a refunded payment back to `PAID` and refunding again was idempotent before this change. Confirmed by reverting the refactor (the verify script still passes) and by comparing the old and new decrement rules across every from-status/full-partial pair, which are behaviourally identical while `PAID_PAYMENT_STATUSES` has a single member.
>
> The decision stands as **hardening, not a fix**: the rule was duplicated across two files, one of which wrote `Payment.status` directly, so the two had to be kept in step by hand. Consolidating it into `applyTotalSoldForPaymentTransition` means the anticipated second paid status (see the comment on `PAID_PAYMENT_STATUSES`) cannot make them diverge silently.

*Alternative considered:* recompute `totalSold` from order history on read. Rejected for now — it is a public sort key (`product.validation.ts:266-273`) on the storefront's hot path, and unlike coupon usage it aggregates across all orders rather than one coupon's. `scripts/backfill-total-sold.mjs` already exists to reconcile the backlog.

### 5. Refund void unwinds inside one transaction, or not at all

Voiding reverses the refund row, the `Payment` status, the `ReturnRequest` completion, and the `totalSold` delta together.

*Why:* creation applies all four in one transaction (`refund.service.ts:39-85`). A partial unwind leaves four records disagreeing about one event — strictly worse than the original mistyped amount, and harder to diagnose because each record individually looks plausible.

*Decision within it:* voiding restores the `ReturnRequest` to its pre-refund status rather than to a fixed status, so a return that was already `COMPLETED` for its own reasons is not silently reopened.

*Consequence:* nothing records that prior status today — `createRefund` writes no `AuditLog` at all (the only write in `refund.service.ts` is the `returnRequest.update` at `:53`). Creation must start recording it before voiding can restore it, which orders the work: the audit-log write is a prerequisite of the void endpoint, not a tidy-up after it.

### 6. Guard and correction ship together, per group

`tasks.md` groups are ordered by severity and each contains its guard, its correction path, and a backlog report.

*Why:* this is the lesson from the archetype. Shipping the purchase-order variant guard alone would have left every existing merchant with unsellable stock and no route to fix it; shipping the reassign endpoint alone would have let the same rows keep accumulating. Neither half is releasable on its own.

### 7. Transition rules live in the service, and the UI derives from them

Legal transitions for orders and returns are defined server-side; the admin UI offers only what is currently legal.

*Why:* the return double-restock is reachable precisely because the UI offers every status unconditionally (`return-detail-page.tsx:160-162`) while the service validates nothing. Fixing only the UI leaves the API open; fixing only the service leaves the UI generating requests that fail. The service is authoritative and the UI reads from the same definition.

## Risks / Trade-offs

- **A restock-on-cancel makes cancellation slower and able to fail** → It becomes a transaction over every order line. Acceptable: a cancellation that half-restocks is the bug being fixed. The status change rolls back with it (spec: "A failed side effect leaves the status unchanged").
- **Deriving coupon usage adds a query to checkout** → Measure before committing (task 5.3); the stored-counter fallback in 5.2 remains available. The check already runs a comparable count for `perCustomerLimit`.
- **Backfilling `totalSold` while orders are being placed could race** → Run the existing backfill during low traffic, and make it recompute absolute values rather than apply deltas, so a concurrent write is corrected by the next run rather than compounded. `scripts/backfill-stock-mirror.ts` documents this exact idempotency property.
- **Narrowing purchase-order editing could let an amendment race a receipt** → Both must re-read the line inside the transaction and re-check `receivedQuantity`; an amendment computed against a stale read must fail rather than overwrite.
- **New enum value on `StockMovementType`** → Additive; existing rows and filters are unaffected. Consumers that switch exhaustively over the type need updating, which the type checker surfaces.
- **Backlog reports show problems with no one obliged to act** → Each report names the admin screen that fixes the rows it lists, as `report-variantless-stock.ts` does. Reports are read-only and safe to run in production.

## Migration Plan

1. **Additive schema first** — the new `StockMovementType` value, deployable ahead of any code that writes it.
2. **Per group, in `tasks.md` order** (severity-ordered): guard, then correction path, then backlog report. Each group is independently deployable and independently revertible; nothing in group N+1 depends on group N.
3. **Reports before corrections are announced** — running the read-only report first sizes the backlog and tells operators what they will be asked to fix.
4. **Rollback** — each group reverts on its own. The enum value can stay behind after a revert (unused values are inert). Corrections already applied stay valid: they are ordinary movements and audit-logged rows, not a parallel representation that a revert would strand.

## Open Questions

- Whether a refund issued for goods the customer keeps (spec: "A refund completes a return whose goods were not returned") needs its own recorded reason code, or whether the absence of a restock movement is sufficient signal. Deferrable — it affects reporting vocabulary, not the correction paths or their guards.
