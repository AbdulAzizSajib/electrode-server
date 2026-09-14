## Context

See proposal.md — Why.

The constraint that shapes everything below is that `OrderService.placeOrder` already is the one implementation of order placement, and was deliberately kept that way when a second entry point last appeared. The campaign landing page does not create orders; it turns a three-field form into `placeOrder`'s payload and passes an `ICheckoutOverrides` object stating exactly how its path differs. `ICheckoutOverrides`'s own doc comment names a second implementation of order creation as "the risk this parameter exists to avoid" (add-single-product-landing-page design.md, Decisions 3 and 8). A manual order is a third entry point to the same transaction, so it takes the same shape.

The pieces it needs are already in place:

- `ICheckoutActor` is a discriminated union precisely so "neither a session nor a guest identity" is unconstructible rather than a runtime guard. `resolveCheckoutContext` branches on it and returns `{ customer, shippingAddressId, shippingAddress }`, after which checkout is one code path.
- `CustomerService.getOrCreateCustomerByPhone` is the phone-as-identity resolver, already normalising to a Bangladeshi mobile number and already racing safely on the unique constraint.
- `createInlineShippingAddress` stores a typed-in address for either actor branch — it was widened past the guest branch when landing pages appeared, and its doc comment says the rule is about the address, not the session.
- `quoteCharges` already takes `discountAmount` as an input and allocates it across lines by value before tax, so an order-level staff discount needs no new pricing arithmetic.
- `loadPayloadLines` already turns `{ productId, variantId, quantity }` into priced lines read from the database.

On the images half: `ORDER_ITEM_IMAGE_INCLUDE` and `flattenItemImages` exist and are correct. The bug is purely in where they are wired. `flattenItemImages` is only ever called from inside `withoutItemCosts`, which is only called on customer-facing paths, and `ORDER_LIST_INCLUDE` asks for `items: true` with no image relations at all. So the staff detail read returns nested `product.images[]` / `variant.image` rows that no client knows to read, the staff list read returns no image data whatsoever, and the customer list read runs the flatten over rows that never had the relations — yielding `image: null` on every line.

## Goals / Non-Goals

**Goals**

- One implementation of order placement, still, after this change. A manual order differs from a checkout in a stated, enumerable set of ways and in nothing else.
- The difference is expressed in the type system where possible, so a branch that forgets the manual case fails to compile rather than at runtime.
- `items[].image` has one shape across every order read — list and detail, staff and customer — so a client has one thing to render.
- The migration is purely additive, so it can ship before the admin panel consumes any of it.

**Non-Goals**

- Editing a placed order. Creation only; changing lines after the fact is a separate problem with its own stock and money reconciliation, and the existing status/cancel flows already cover the operations staff have today.
- Per-line price entry. Ruled out in favour of an order-level discount — see Decision 4.
- Coupons on manual orders. See Decision 5.
- Reporting by channel. This change records `channel` and makes it filterable; revenue-by-channel reporting is downstream work that the column makes possible.
- Snapshotting order item images at placement. See Decision 9.
- Backfilling `channel` on historic orders beyond the column default. See Migration Plan.

## Decisions

### Decision 1 — A third `ICheckoutActor` kind rather than a flag on the payload

`ICheckoutActor` becomes:

```ts
| { kind: "user"; userId: string }
| { kind: "guest"; guestToken?: string; ip: string }
| { kind: "staff"; staffUserId: string }
```

**Why.** The union's whole stated purpose is to make an unrepresentable actor unrepresentable. A staff user placing an order on someone else's behalf is a genuinely different actor from both existing cases — it has a session, but the session does not belong to the person the order is for — and adding it here means every `switch` on `actor.kind` in the module gets a compile error until it accounts for the new case. Several of the behaviours that must differ (guest caps, `isGuestOrder`, `guestIp`, the COD payment row) are already keyed off `actor.kind`, so the type is the natural place to put the distinction.

**Alternatives considered.** A `manual: true` field on `ICheckoutOverrides`, mirroring the landing page. Rejected: `ICheckoutOverrides` describes how a *checkout* differs while keeping the same actor, and the landing page's actor genuinely is a guest. Carrying "who is acting" in the overrides bag while `actor` says something else would put two answers to the same question in one function, and nothing would fail to compile when a branch read the wrong one. A `staffUserId?: string` on the payload was rejected for the same reason, plus it would be reachable from a request body.

`ICheckoutOverrides` is still used, for the parts that genuinely are checkout-shaped differences (`bypassCheckoutConfig`, already existing).

### Decision 2 — `POST /orders/manual`, not a widened `POST /orders`

A separate route with `checkAuth(...ADMIN_PANEL_ROLES)` and its own zod schema.

**Why.** `POST /orders` is `optionalAuth` and serves guests — the one path that must work with no account. Adding a staff branch to it would mean a single validation schema describing both a shopper's checkout and an operator's order entry, with fields each must not be able to send, and a role check living inside the service rather than at the route. Two routes means the storefront's checkout schema cannot grow a `discountAmount` field, which is the field most worth making unreachable.

Declared above the `/:id` group in `order.route.ts`, matching the file's existing convention and its comments, even though no `POST /:id` exists today to capture it.

### Decision 3 — Manual orders reuse `placeOrder`'s core; the deltas are enumerated

The full list of what a `staff` actor changes, and nothing else changes:

| Concern | Checkout | Manual |
|---|---|---|
| Customer | session or phone | phone (`getOrCreateCustomerByPhone`) |
| Guest COD caps | enforced for guests | not enforced |
| `checkoutConfig` field map + `allowGuestCheckout` | enforced for guests | bypassed |
| `isGuestOrder` / `guestIp` | true / IP for guests | false / null |
| COD `Payment` row | guests only | always |
| `statusHistory.changedById` | null | the staff user |
| `discountAmount` | from coupon | from staff input |
| `channel` / `createdByUserId` / `discountReason` | `WEBSITE` / null / null | stated / staff user / stated |

Everything else — order number generation and its collision retry, `loadPayloadLines`, `quoteCharges`, `deductStockForOrderLines`, the `PENDING` starting status, idempotency, the low-stock notification, the staff "new order" notification — is shared and untouched. This table is the thing to keep true; if it grows past about a dozen rows, the shared core has stopped being shared and that is the signal to revisit.

The phone floor and the address requirement are *not* in the delta column: they still apply. They are not part of `checkoutConfig`'s bypassable field map (the floor is already checked independently of it, for the reason its comment gives), and an order with no phone cannot be looked up or delivered.

### Decision 4 — Catalog pricing with one order-level discount, not editable unit prices

Lines carry `{ productId, variantId?, quantity }` only. Any price in the body is ignored rather than rejected, matching how `loadPayloadLines` already treats the landing-page path. The negotiated amount is `discountAmount` plus a required `discountReason`, both stored on the order.

**Why.** "Never trust a price from the client" is the existing rule on this endpoint's sibling, and it is the rule that makes `unitPrice` a fact worth snapshotting. Editable unit prices would make an order's line prices unverifiable against the catalog and would quietly corrupt margin reporting, which reads `unitCost` against `unitPrice`. An order-level discount keeps every line's price provably catalog-derived and puts the whole negotiation in one auditable number with a stated reason.

**Trade-off, stated plainly.** "Buy this, get the case free" cannot be expressed as a zero-priced line; it is expressed as a discount equal to the case's price, with that as the reason. The money is identical and the reason is more informative; what is lost is per-line attribution of the discount for reporting. `allocateDiscount` already spreads an order discount across lines by value for tax purposes, so the tax is right either way.

**Validation.** `discountAmount >= 0`, `<= subtotal` (checked after pricing, since the subtotal is not known until the lines are read), and `discountReason` required and non-empty whenever `discountAmount > 0`.

### Decision 5 — No coupons on a manual order, for now

`couponCode` is not accepted. A staff discount and a coupon would otherwise both write `Order.discountAmount` and `Order.couponCode`, and deciding whether they stack, which wins, and what `discountReason` means when a coupon supplied the money is a decision with no obvious right answer and no current demand — a seller negotiating on WhatsApp is not typing a coupon code.

This is a deliberate v1 boundary rather than a permanent one. If it is wanted later, the honest shape is "either a coupon or a manual discount, never both", which is a validation rule and not a redesign.

### Decision 6 — `channel` as a column with a default, `createdByUserId` as a nullable relation

```prisma
enum OrderChannel { WEBSITE WHATSAPP MESSENGER PHONE IN_STORE OTHER }

channel         OrderChannel @default(WEBSITE)
createdByUserId String?
createdBy       User?        @relation(fields: [createdByUserId], references: [id], onDelete: SetNull)
discountReason  String?
```

`SetNull`, not `Cascade` — deleting a staff account must never delete the orders they took. `@@index([channel])` to serve the list filter and any future channel report.

**`LANDING_PAGE` is deliberately absent from the enum.** `Order.landingPageId` already answers "did a campaign produce this", and its own schema comment explains why campaign attribution is split the way it is. A second field answering the same question would have to be written correctly at every call site forever, and the first time one of them is missed the two disagree with no way to tell which is right. A landing-page order reads `WEBSITE` — which is true; it came through the storefront — and carries its campaign on `landingPageId`.

**Why a default rather than nullable.** Every existing order genuinely was placed through the storefront, so `WEBSITE` is not a guess for the backfill. `createdByUserId` stays nullable because the absence of a person is the meaningful signal — it is what says the customer placed this themselves.

### Decision 7 — The COD payment row is created for manual orders too

Today the `Payment` row is created only when `isGuest`. An authenticated storefront order gets none, which is existing behaviour this change does not touch. A manual order gets one.

**Why.** A COD order with no `Payment` row is money the reconciliation view cannot see, and a manual order is COD by definition here — the customer has agreed to pay the courier. The condition becomes "this order is cash-on-delivery" rather than "this actor is a guest", expressed as `isGuest || actor.kind === "staff"` rather than by reworking the authenticated path, because widening it to every order is a change to existing reconciliation with its own consequences and is not what was asked for.

### Decision 8 — Images: wire the existing helpers into the paths that miss them

Three edits, no new machinery:

1. `ORDER_LIST_INCLUDE.items` becomes `{ include: ORDER_ITEM_IMAGE_INCLUDE }`.
2. `flattenItemImages` is lifted out of `withoutItemCosts` at the call sites — every order read applies it, and `withoutItemCosts` additionally strips `unitCost` on the customer-facing ones. The staff reads that currently return raw rows (`getOrders`' staff path, `getOrderById`'s staff branch, `updateOrderStatus`) each gain the flatten.
3. Nothing else. `ORDER_DETAIL_INCLUDE` is already correct.

**Why not narrow `withoutItemCosts` further, or add a staff-specific include.** The existing comment on `withoutItemCosts` explains that the strip is at the boundary rather than in the include precisely so staff and customer reads share one include and cannot drift. Flattening has the same property and belongs in the same place; the mistake was making one a subroutine of the other, so that the cost strip's audience silently became the flatten's audience too.

**Cost of the list change.** One extra `ProductImage` row and one `ProductVariant.image` per order line, on order rows already being fetched — a join, not a query per row. This is the same reasoning `ORDER_LIST_INCLUDE` already records for carrying `items` and narrowing `shipments`.

### Decision 9 — The image is today's catalog picture, not a placement snapshot

Already decided and documented in `ORDER_ITEM_IMAGE_INCLUDE`'s comment; restated here because this change is what makes it visible on the list, where it will be noticed. `productName`, `sku` and `unitPrice` are snapshotted because they are what the customer was sold and are accountable facts of the transaction. A photograph is not one, and an operator matching a parcel against a shelf wants the picture of what is on the shelf now.

### Decision 10 — `quoteCheckout` learns the staff actor and the staff discount

Widening `ICheckoutActor` forces `quoteCheckout` to account for the new kind anyway (it branches on `actor.kind` to resolve a customer and a cart). The staff branch resolves neither: it prices the payload's lines and returns.

Two things make this more than a compile fix:

- **No customer for the operator.** The `user` branch runs `getOrCreateCustomerByUserId`, so a staff member pricing a customer's basket would quietly acquire a `Customer` row against their own admin account — polluting the customer list and any per-customer count derived from it. Pricing must have no side effects.
- **The quote must carry `discountAmount`.** `IQuoteCheckoutPayload` gains it for the staff actor. Without it, the panel would have to subtract the discount from a quoted total itself, which is wrong: `allocateDiscount` spreads the discount across lines *before* tax, so the tax on a discounted order is not the tax on an undiscounted one minus anything the client can compute.

**Why not let the admin panel compute the total.** Tax is per product's own rule, delivery can be waived by a free-shipping threshold, and the discount changes the taxable base. `quoteCheckout`'s own doc comment says two implementations of "what does this cost" is exactly how a quote and a charge drift apart. The operator reads this figure aloud to a customer before committing, so a drift is discovered by the customer.

### Decision 11 — Idempotency via the existing `Idempotency-Key` header

The manual endpoint reads the same header the controller already reads for checkout, and passes it down the same path. `findReplayableOrder` re-checks that the key resolves to an order for the same customer, which holds here too.

**Why it matters more here than at checkout.** A double-submitted manual order deducts stock twice and creates a second parcel for a customer who ordered one, with no shopper on the other end to notice the duplicate confirmation.

## Risks / Trade-offs

**A staff-placed order bypassing `checkoutConfig` can record an address the courier cannot use** → The phone floor and a required `addressLine1` still apply; the fields `checkoutConfig` governs beyond those (city, postal code) are the ones a merchant has already chosen to make optional for shoppers. The admin form asks for them anyway, so the bypass only matters to a direct API call.

**Editable prices were asked for in spirit and only a discount is delivered** → Stated explicitly in Decision 4 with the free-gift workaround, so the limitation is visible before implementation rather than discovered by the seller. The total achievable is the same; only per-line attribution is lost.

**Widening `ICheckoutActor` touches every `switch` on `actor.kind`** → That is the point, and it is a compile-time cost paid once. `quoteCheckout` also takes an actor and will need to reject or handle the staff kind explicitly.

**The list read grows two relations per line** → Bounded by lines per order on one page of orders, and it replaces no round trips because today there are none to replace. If a page of 100 orders with large baskets becomes slow, the mitigation is a smaller page size or `take: 1` on the variant image, not removing the feature.

**`discountReason` is free text and will be used inconsistently** → Accepted. A fixed reason taxonomy invented before anyone has used the feature would be wrong, and free text is honest about what it is. If reasons cluster, that is the evidence for a taxonomy later.

**Staff orders are exempt from the COD caps, so a compromised staff account can place unlimited orders** → It can already do more damage than that with the catalog and refund endpoints. `createdByUserId` is what makes this attributable, which is the actual mitigation, and it is why the column is part of this change rather than a follow-up.

## Migration Plan

1. Additive Prisma migration: `OrderChannel` enum, `Order.channel` (default `WEBSITE`), `Order.createdByUserId`, `Order.discountReason`, `@@index([channel])`. No column dropped, no row rewritten. `pnpm -C server migrate` then `pnpm -C server generate`.
2. Existing rows take `WEBSITE` from the column default. No backfill script — the default is correct for every order placed to date, since the manual path did not exist. Landing-page orders also read `WEBSITE` by design (Decision 6).
3. Service and route changes deploy behind no flag; the new endpoint is inert until the admin panel calls it, and the response additions are purely additive so no existing client breaks.
4. Update `postman/Ecom.postman_collection.json` in the same change — `verify:postman` fails on drift in either direction, so this is not a follow-up.
5. **Rollback**: revert the service and route changes; the three columns can stay. They are nullable or defaulted and no read depends on them existing. Only if the migration itself must be undone does `channel` need dropping, and at that point any manual orders already placed are ordinary orders with a lost provenance field — recoverable from `OrderStatusHistory.changedById`, which records the staff user independently.

## Open Questions

- Whether a manual order should be creatable for a *collection* (`PICKUP`) delivery option. The endpoint accepts a `deliveryOptionKey` and `quoteDelivery` already resolves either kind, so it works; the question is only whether the admin form should offer it. Deferrable — it changes no spec, no schema and no task here, only which options the form lists.
