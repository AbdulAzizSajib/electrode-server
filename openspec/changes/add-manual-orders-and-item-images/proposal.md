## Why

Not every sale arrives through the storefront. A large share of this merchant's orders are agreed in a WhatsApp or Messenger conversation, and today there is no way to turn one of those conversations into an order: the seller either asks the customer to re-enter everything on the website, or the sale never becomes an `Order` at all — so it deducts no stock, joins no report, prints no invoice and cannot be handed to the courier. The panel's whole fulfilment pipeline is built on orders existing, and a third of the shop's revenue is invisible to it.

Separately, both of the admin's order surfaces name what was bought in words only. An operator packing a parcel or answering "is this the black one?" on the phone is matching a picture against a shelf, and the list and detail pages give them a product name to do it with. The server already fetches the thumbnail for an order line — `ORDER_ITEM_IMAGE_INCLUDE` and `flattenItemImages` exist — but the list read never asks for it and the staff detail read never flattens it, so the picture reaches nobody.

## What Changes

**Manual order creation**

- New staff-only endpoint `POST /orders/manual` (OWNER/ADMIN/STAFF) that creates an order on a customer's behalf from a phone number, an address, and a set of catalog lines.
- It runs through the existing `OrderService.placeOrder` core rather than reimplementing checkout, extending the same seam the landing-page path uses. Stock deduction, the order number, status history, idempotency, low-stock and staff notifications are shared, not copied.
- A third `ICheckoutActor` kind, `staff`, so "an order created by an operator on behalf of someone else" is a representable actor rather than a guest checkout wearing a disguise. Guest COD abuse caps do not apply to it; the operator is an authenticated, audited person.
- Lines are priced from the catalog exactly as checkout prices them — a unit price in the request body is still never trusted. A negotiated price is expressed as one order-level `discountAmount` with a required reason, which is what a WhatsApp haggle actually is.
- Manual orders start in `PENDING`, the same status a website order starts in, and get the same `PENDING` cash-on-delivery `Payment` row a guest COD order gets. An advance already collected is recorded afterwards through the existing `POST /orders/:id/payments`.
- `POST /orders/quote` learns the staff actor, so an operator can state a total to a customer mid-conversation and have it be the total the order is created with. It must price the staff discount, and must stop short of the `getOrCreateCustomerByUserId` call that would otherwise turn the operator's own account into a customer record.

**Order provenance**

- New `OrderChannel` enum and `Order.channel` column (default `WEBSITE`) recording where the customer came from: `WHATSAPP`, `MESSENGER`, `PHONE`, `IN_STORE`, `OTHER`.
- New `Order.createdByUserId` recording which staff user placed a manual order, null for a self-service one.
- New `Order.discountReason` recording why a staff discount was given.
- Campaign attribution is *not* folded into `channel` — `landingPageId` already answers that, and a second source of truth for the same question is how the two drift.

**Order item images**

- `ORDER_LIST_INCLUDE` carries each line's thumbnail, so the orders list returns `items[].image` the same way the detail read does. One extra relation on rows already being fetched — not a request per row.
- Every staff-facing order read flattens item images. Today only the customer-facing paths do, because flattening rides inside `withoutItemCosts`, so staff receive nested `product.images[]` / `variant.image` rows on some reads and nothing at all on others. Staff and customer reads return the same `items[].image` shape after this.

## Capabilities

### New Capabilities

_None._ Manual order creation is another way to reach the same order-placement behaviour the checkout capability already owns, and putting it elsewhere would split one transaction's rules across two specs.

### Modified Capabilities

- `api/checkout`: adds staff-initiated order creation (who may place one, how it is priced, what stock and payment rules it shares with checkout, what limits it is exempt from), adds order provenance as a recorded property of every order, and adds the requirement that an order read names each line's current product image consistently for staff and customers alike.

## Impact

**Schema / migration** — `Order` gains `channel` (new `OrderChannel` enum, default `WEBSITE`), `createdByUserId` (nullable, `SetNull` to `User`), and `discountReason` (nullable). One additive migration; no column is dropped and no existing row needs rewriting. Requires `pnpm -C server generate`.

**Code** — `order.route.ts` (new route, declared above the `/:id` group), `order.controller.ts`, `order.validation.ts`, `order.interface.ts`, `order.service.ts` (`ICheckoutActor`, `resolveCheckoutContext`, `placeOrder`, `ORDER_LIST_INCLUDE`, `getOrders`, `getOrderById`, `updateOrderStatus`). `customer.service.ts`'s `getOrCreateCustomerByPhone` is reused unchanged.

**Contract** — [postman/Ecom.postman_collection.json](../../../postman/Ecom.postman_collection.json) gains the manual-order request under the admin Orders folder; `verify:postman` fails until it does. Existing order responses gain three scalars and `items[].image`; nothing is removed or renamed, so both clients keep working untouched.

**Clients** — the admin panel consumes all of this; that work is `add-manual-orders-and-item-images-admin` in the admin repo. The storefront is unaffected: it reads its own orders through paths that already flatten images, and it cannot reach the new endpoint.

**Verification** — a new `verify:manual-order` script covering the staff path end to end (pricing, stock, payment row, channel, exemption from guest caps), plus an extension to `verify-checkout-totals.ts` asserting the discount arithmetic. There are no unit tests on the server by design.
