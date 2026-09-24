## Context

See proposal.md — Why. This section records only what the existing code forces on the design.

Four facts shape everything below:

1. **`Order` has no `paymentMethod` column.** How an order is paid lives entirely on its `Payment` child rows (`order.prisma` has `payments Payment[]` and nothing else payment-shaped). "Is this order blocked on verification" is therefore a derived question, not a column read.
2. **`Payment` already carries `transactionId String? @unique`**, and `PaymentMethod` already has `BKASH`, `NAGAD`, `ROCKET`, `BANK_TRANSFER`; `PaymentStatus` already has `PENDING`, `PROCESSING`, `PAID`, `FAILED`. `PROCESSING` is currently written by no code path. No enum changes are needed.
3. **`checkoutConfig` is read with a wholesale `merge()`**, which swaps in the default object wholesale when a stored row lacks a key. `withDeliveryDefault` (`store-setting.service.ts:745`) exists solely to paper over this for the one key added since the column was created. Its doc comment states the failure it prevents: without it, every store configured before that change fails `checkoutConfigSchema.safeParse` and falls all the way back to `DEFAULT_CHECKOUT_CONFIG`, silently discarding the merchant's real field, notice and guest-checkout settings.
4. **Order status transitions are currently unrestricted.** `allowedOrderTransitions` (`order.service.ts:1873`) returns every status except the current one; the forward-only map was deliberately removed (`add-order-fulfillment-documents`, design.md Decision 6) and survives only as a comment showing how to restore it. Exactly two code paths write `order.status`: `updateOrderStatus` (:2145) and customer self-cancel (:2077). Courier dispatch reads but does not write it, refusing anything not `PACKED` (`courier.service.ts:216`).

## Goals / Non-Goals

**Goals:**
- One verification concept, reachable from one place, that both payment choices and both payment channels (mobile banking, bank transfer) flow through.
- The blocking rule enforced where status is *written*, not where the admin UI offers a button — the UI hiding an action is a convenience, never the control.
- No new shim class of bug: adding a key to `checkoutConfig` must not repeat the `withDeliveryDefault` problem for the next person.
- A store with the feature off runs code paths indistinguishable from today's.

**Non-Goals:**
- Automatic reconciliation against a bKash/Nagad API. Verification is a human reading a statement; see proposal.md — Out of scope.
- Reworking the unrestricted-transition decision. This change adds one orthogonal check; it does not restore the forward-only map.
- Making the existing authenticated-storefront path create a `Payment` row when it doesn't today (`order.service.ts:1284-1288` documents that as deliberate legacy). Advance payment creates its row on every path, which is a narrow exception, not a general fix.

## Decisions

### Decision 1 — `advancePayment` is an optional key on `checkoutConfig`, not a required one

Adding it as required repeats fact 3 exactly: every existing store's `checkoutConfig` would fail the strict parse and collapse to defaults, and the fix would be a second single-key shim beside `withDeliveryDefault`.

Instead `advancePayment` is `.optional()` on `checkoutConfigSchema`, and the read layer normalizes `undefined` to `{ enabled: false, mobileAccounts: [], bankAccounts: [] }`. An absent key and an explicitly disabled block are then the same thing, which is exactly the semantics wanted: a store that predates the feature has it off.

**Alternative considered:** generalize `withDeliveryDefault` into a `withCheckoutDefaults` that fills every missing key from `DEFAULT_CHECKOUT_CONFIG`. Tempting, and it would retire the one-off. Rejected for this change because it widens the blast radius to `delivery` — a key whose absence currently has a *specific, documented* meaning — for a benefit that optionality already delivers. Worth doing on its own, not underneath a feature.

**Consequence to honor:** `checkoutConfigSchema` is `.strict()` in both its stored and update forms, and the shape is mirrored by hand in `nextjs/src/types/store-settings.ts` and `admin/src/lib/api/store-settings.ts`. All three plus the `StoreSetting.prisma` doc comment change together. That doc comment is already drifted (it omits `delivery`); correcting it is part of this change.

### Decision 2 — accounts are a list on `StoreSetting`, addressed by a stable generated id

The shopper must read the merchant's bKash number off the checkout page, so it is published by the act of being used. The rule at `StoreSetting.prisma:385-388` — "what the browser sees anyway goes in this column; what it must never see goes in the credential table" — puts it on `StoreSetting`, the same call already made for the Facebook Pixel id versus its CAPI token.

Each account carries an `id` the admin generates on creation and never rewrites, because the order's payment row references it. Addressing accounts positionally would reattach every historical claim to a different account the first time the merchant reorders or deletes a row. This is the same reasoning as the delivery options' `key`, and the opposite of its behavior: `newOptionKey` in the checkout settings page generates a positional slug that survives renames but not reordering — acceptable for a label, not for a foreign reference.

Editing an account's *details* (a number changes) does not rewrite history: the payment row stores both the account id and a snapshot of the details as they stood at placement, the same capture-at-placement pattern `Order.deliveryOptionLabel` already uses. A claim remains readable after the merchant closes that bKash account.

**Alternative considered:** `IntegrationCredential` with `secret: false`. `ICredentialDescriptor` does support it, for "an account id the other side treats as public". Rejected: it sits behind an authenticated admin read, so the storefront could not display it without a new public endpoint — precisely the trade-off `integrationConfig`'s comment calls unacceptable.

### Decision 3 — the claim lives on `Payment`, and the advance is one row, not two

An advance-delivery-charge order has ৳130 claimed and ৳790 due. Two obvious shapes:

- **Two rows** — an advance row for ৳130 and a COD row for ৳790. Truthful about the split, but it duplicates the COD row that `order.service.ts:1266` already creates for the full total on guest and staff orders, and every consumer that sums payments (the admin's `paidTotal`, the payments report) would need to learn which rows are real.
- **One row for the advance only** (chosen). The advance is a `Payment` of exactly the amount sent, in `PROCESSING`. The remainder is not a payment row at all — it is the balance, which the admin order detail already derives and renders as "balance due" (`order-detail-page.tsx:618-633`) and which therefore displays correctly with no change. A COD row for the remainder is recorded on delivery through the existing `POST /orders/:id/payments`, which is the path the codebase already prescribes for money collected later.

For the **full-payment** choice the same row is simply the full total, and the balance derives to zero. One code path, one row, the amount being the only difference — which is what the spec requires.

**Consequence:** `order.service.ts:1266-1296` currently hardcodes `amount: totalAmount, method: COD` for guest and staff orders. That block becomes conditional on the payment choice. Its surrounding comment states the current invariant — *"money already collected in advance is recorded afterwards through `POST /orders/:id/payments` rather than at creation, so there is one way to record a payment rather than two"* — and this change is a deliberate, narrow exception to it: a claim made *during* checkout has no later moment to be recorded at. The comment must be updated to say so rather than left contradicting the code.

### Decision 4 — new `Payment` columns, not `gatewayResponse`

`Payment.gatewayResponse Json?` is unused and would hold the sender number and account reference without a migration. Rejected: a Json column is unconstrained by Postgres, so the values deciding whether an order ships would live outside the type system, and no query could find "all claims from this sender number". The fields are typed columns:

- sender identifier (a phone number for mobile banking, a depositor name/account for bank transfer)
- the merchant account id referenced, plus the snapshot of its details
- verification actor, verification timestamp, rejection reason

`transactionId` and its `@unique` are reused unchanged.

**On the unique constraint:** it is a real behavior, not an incidental one. A reused transaction id is currently a raw Prisma `P2002` surfacing as a 500. The service checks for the existing reference first and throws a 409 naming it, keeping the constraint as the backstop for the race. Note this means a *rejected* claim still occupies its reference — stated in the spec, because the alternative (freeing it on rejection) lets a shopper resubmit the same fabricated id until a different admin passes it.

### Decision 5 — the blocking rule is a service-level assertion at the two status writers

"An order awaiting verification cannot advance" is enforced by one predicate — *does this order have a `Payment` in `PROCESSING` whose method is an advance method* — asserted in `updateOrderStatus` before `assertOrderTransitionAllowed`, and again in the customer self-cancel path only to the extent of *not* blocking it (cancel stays permitted, per the spec).

It is deliberately **not** implemented by restoring the forward-only transition map, and not by a new `OrderStatus` value:

- A new status (`AWAITING_PAYMENT`) would be a fifth thing every status consumer must learn — the admin dropdown, the courier's `PACKED` check, the reports' revenue definition in `sales.constant.ts`, the customer-facing timeline. The order genuinely *is* `PENDING`; what is blocked is movement, which is a rule about transitions, not a state.
- The transition map is about what *can follow what*. Verification is about whether *this order* may move at all yet. Folding the second into the first makes the error message unable to distinguish them, which the spec explicitly requires it to do.

Ordering matters: the verification check runs **before** the no-op and legality checks so that an admin confirming an unverified order is told about verification, not about a transition that was legal anyway.

Courier dispatch needs no change: it refuses anything not `PACKED`, and an unverified order cannot reach `PACKED`.

### Decision 6 — verify and reject are distinct operations, not a status write

The existing `PATCH /orders/:id/payments/:paymentId` (`updatePaymentStatus`) is staff-gated, transactional, and already stamps `paidAt` on the `!wasPaid && isNowPaid` transition and adjusts sold counts. It is close to what is needed and is **not** reused directly: it accepts any `status` as a free parameter, so "verify" would be spelled as "set status to PAID", and rejection would be "set status to FAILED" with the reason travelling in no defined field. Neither records a verifier.

Two named operations instead — verify and reject — each writing the actor and timestamp, each audit-logged with the decision, each refusing a payment that is already decided (409, per the spec, rather than overwriting a prior decision). They reuse `updatePaymentStatus`'s internals for the sold-count and `paidAt` handling rather than reimplementing them.

The customer-facing hole to close explicitly: `POST /orders/:id/payments` is currently `checkAuth(...ALL_ROLES)`, so a customer can create a payment row today. With advance payment live, a customer creating a `PAID` row on their own order would self-release it. The create path is constrained so a non-staff caller cannot set `status`, and the verify/reject operations are `ADMIN_PANEL_ROLES` only.

### Decision 7 — the advance amount is computed server-side and revalidated at placement

Checkout already sends `expectedTotal` and the server already refuses a mismatch; the advance amount joins it. The client displays what the quote returned; the placement path recomputes from the selected choice and the delivery option actually resolved, and refuses a mismatch with a 409 rather than creating an order for the wrong sum.

This is what makes the "shopper changed their delivery option after choosing a payment method" scenario safe without the client having to be careful.

## Risks / Trade-offs

**A verified claim is a human judgment, and humans approve fake ones** → Nothing here validates that money arrived; it records who said it did. The audit trail names the verifier on every decision, which makes a pattern attributable after the fact. Stated plainly because the feature can otherwise read as fraud-proof.

**Orders now pile up waiting on a human** → A merchant who does not check their statement accumulates orders that cannot ship, and the shopper has paid. Mitigation is visibility, not automation: unverified claims need to be findable as a group in the admin, not only on an order that someone happens to open. Any "auto-verify after N hours" fallback is a direct defeat of the feature and must not be added.

**`checkoutConfig` grows a fourth hand-synced copy** → Zod, nextjs types, admin types, Prisma doc comment. The project already carries this obligation and already has one drifted comment as evidence of the cost. Mitigation is that the drift is corrected in this change, and the verify script asserts the shapes agree.

**The unique transaction id is global across all payments, not per account** → Two different merchants' accounts cannot collide here (single-tenant store), but a bank deposit slip number and a bKash TrxID share one namespace. Collision is implausible in practice; the failure mode is a false 409 telling an honest shopper their reference is used. Accepted rather than scoped per-account, because per-account uniqueness would need a compound constraint and the honest-collision rate is negligible against the duplicate-submission rate it prevents.

**Money is claimed before the order is known to be placeable** → A shopper sends ৳130, then placement fails on stock. The advance is real money against no order. Mitigated by ordering: stock and price validation run before the claim is accepted, so the common case fails before the shopper is asked for a transaction id. It cannot be eliminated — the shopper sends money out-of-band, on their own phone, before submitting. The refund path for this is out of scope and noted in the proposal, which means the first version answers it by hand.

**Feature off must be provably unchanged** → The whole design rests on absent-config meaning off. A verify script asserts that a store with no `advancePayment` key places a plain COD order through the identical code path, and that the blocking predicate is never consulted for an order with no advance payment row.

## Migration Plan

1. **Schema first, feature off.** The `Payment` columns are all nullable and additive; no backfill. No existing row has an advance payment, so the blocking predicate is false for every order in the database on the day it deploys.
2. **Watch the generated migration for the trigram `DROP INDEX` lines** — `Product_name_trgm_idx`, `Product_sku_trgm_idx`, `Brand_name_trgm_idx` — and delete them, carrying forward the NOTE block from the previous migration. This change touches an unrelated model, which is exactly when the drop is easiest to miss.
3. **Backend, then admin, then storefront.** The settings key must be writable before the admin editor ships, and configured before the storefront reads it. A storefront deployed early reads an absent key and renders the unchanged COD panel, which is the correct degraded state.
4. **Rollback** is turning the setting off, which stops new claims immediately. Orders already awaiting verification stay blocked and still need a decision — the rollback does not release them, deliberately. A full code rollback additionally needs the `Payment` columns left in place, since dropping them would discard claims against real money.

## Open Questions

- **Where the unverified-claims queue lives in the admin** — its own page, or a filter on the existing orders list. It changes no spec requirement and no backend surface (both read the same predicate), so it can be settled when the admin work starts.
- **Whether the shopper sees a rejection reason, and through which channel** — the reason is captured and audited either way. Surfacing it to the shopper is an additive notification decision that does not change how the claim is stored or decided.
