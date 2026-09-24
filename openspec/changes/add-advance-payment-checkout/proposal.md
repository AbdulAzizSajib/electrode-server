## Why

Guest COD checkout costs the shopper nothing to abandon. `add-guest-cod-checkout` shipped rate limits — `maxPendingCodOrdersPerPhone` (3) and `maxGuestOrdersPerIpPerHour` (10) — and named OTP verification as the out-of-scope alternative, but neither addresses the actual loss: a fake order is packed, handed to a courier, refused at the door, and returned. The merchant pays the courier both ways and eats the return handling, whatever the cap is set to. A limit of 3 pending orders per phone still permits 3 round trips paid for by the merchant.

Taking the delivery charge up front changes the economics rather than the volume. A shopper who has sent ৳130 by bKash has spent real money to place the order, which is the thing a rate limit cannot ask for. There is no payment gateway integration here and no gateway fees: the shopper sends money to the merchant's own bKash/Nagad/bank account, types the sender number and transaction id into checkout, and an admin verifies it against their own account statement before the order is confirmed.

## What Changes

- **A store-wide advance-payment mode.** Off by default; existing stores behave exactly as they do today. When on, checkout presents two choices — *Cash On Delivery (Advance Delivery Charge Only)*, where the shopper sends the delivery charge now and pays the remainder on delivery, and *Full Payment*, where they send the whole order total now and owe nothing at the door.
- **Merchant payment accounts are configured, not hardcoded.** A new settings block on the Checkout Setting page holds a list of mobile-banking accounts (bKash / Nagad / Rocket, each with a number and an account-type label) and a list of bank accounts (bank name, account name, account number, branch, routing number). These are read by the storefront and rendered for the shopper to copy.
- **Checkout collects a sender number and a transaction id.** Both are required when an advance-payment choice is selected. The shopper picks the account they paid into, so the submitted reference is attached to a specific merchant account rather than guessed at.
- **An order placed this way waits for verification.** It is created with its `Payment` row in `PROCESSING` — money claimed, not yet confirmed — and the order held at `PENDING`. **BREAKING for the order workflow:** an order with an unverified advance payment SHALL NOT be moved to `CONFIRMED` or any later status. This is the whole point of the change; without it the shopper types any eleven digits and the order proceeds regardless.
- **Admin verifies or rejects the claim.** The order detail page shows the claimed amount, method, chosen account, sender number and transaction id. Verifying transitions the `Payment` to `PAID` and releases the order; rejecting marks it `FAILED` with a reason and leaves the order blocked. Both are audit-logged.
- **A duplicate transaction id is refused at checkout.** `Payment.transactionId` is already `@unique`, so a reused reference is a database error today; it becomes a stated 409 naming the problem instead.
- **Guests are no longer COD-only.** `order.validation.ts` currently spells the payment method as `z.literal("COD")` and the service rejects anything else. Both widen to the three checkout-reachable methods.

## Capabilities

### New Capabilities
<!-- None. Advance payment is a payment policy on the existing checkout flow and a
     verification step on the existing payment record; splitting it into its own
     capability would separate requirements that only make sense read together with
     the COD requirements they modify. -->

### Modified Capabilities
- `api/checkout`: Adds requirements for the advance-payment mode, the two payment choices and how each splits the order total, the sender-number and transaction-id capture, duplicate-reference refusal, and the rule that an order with an unverified advance payment cannot advance in status. Amends the existing "Guest orders are cash-on-delivery only" requirement from `add-guest-cod-checkout`, which this change narrows to "when advance payment is off".
- `api/support-and-admin`: Adds the admin verify/reject decision on a claimed payment, its audit-log obligation, and the constraint that a customer may never verify their own payment.

## Impact

**Schema (migration required)**
- `Payment` gains the fields that make a manual claim reviewable: the sender's number/account, which configured merchant account it was sent to, a verification decision (verifier, timestamp, rejection reason). `transactionId` and `@unique` already exist and are reused as-is.
- `Order` gains nothing. There is deliberately no `paymentMethod` column on `Order` today — how an order is paid lives on its `Payment` rows — and this change does not introduce one. "Is this order blocked on verification" is derived from its payments.
- `PaymentStatus.PROCESSING` and `PaymentMethod.BKASH`/`NAGAD`/`ROCKET`/`BANK_TRANSFER` already exist in `enums.prisma`. No enum changes.

**Settings (three hand-synced copies, per the project's standing obligation)**
- `store-setting.validation.ts` — `checkoutConfig` gains an `advancePayment` block. Note `checkoutConfigSchema` is `.strict()`, so the key is rejected until added, and the column is read with a wholesale `merge()` that drops keys absent from already-written rows — the same trap that forced the `withDeliveryDefault` shim when `delivery` was added.
- `nextjs/src/types/store-settings.ts` and `admin/src/lib/api/store-settings.ts` mirror the shape.
- `StoreSetting.prisma`'s `checkoutConfig` doc comment, which is already drifted (it omits `delivery`), is corrected as part of this.

**Code**
- `server/src/app/module/order/order.validation.ts` — `paymentMethod: z.literal("COD")` widens; new advance-payment sub-payload.
- `server/src/app/module/order/order.service.ts` — the non-COD rejection at the guest branch; the `payments: { create: ... }` block, which today hardcodes `amount: totalAmount` and `method: COD`; the status-transition guard.
- `server/src/app/module/payment/` — verify and reject operations beside the existing `updatePaymentStatus`, which already stamps `paidAt` on the →PAID transition and is already staff-gated.
- `admin/` — a payment-accounts editor on the Checkout Setting page; a verification panel on the order detail page, which already renders a "balance due" line that displays a partial advance correctly with no change.
- `nextjs/src/components/checkout/CheckoutForm.tsx` — the payment section, today a static COD panel whose copy reads "No advance payment is needed."

**Out of scope**
- **Any payment gateway.** No bKash/Nagad API, no automatic reconciliation. Verification is a human reading their own account statement, which is what makes this implementable without a merchant agreement.
- **Refunding a verified advance on a cancelled order.** `Refund` exists and is tied to a payment; the workflow for using it here is a separate change.
- **Per-delivery-option policy** (advance required outside Dhaka, not inside). The mode is store-wide. The settings shape does not foreclose it.
- **Storing the merchant's account numbers as encrypted credentials.** A number the shopper must read off the checkout page is published by the act of using it, so it belongs on `StoreSetting` — the same rule that puts the Facebook Pixel id there and its CAPI token in `IntegrationCredential`.
