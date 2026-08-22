## Why

The data model is done (46 models, `prisma validate` clean) but the API surface is not: `src/app/routes/index.ts` only mounts `/auth` and `/users`. Every other domain — catalog, cart/wishlist, checkout/orders, returns/refunds/reviews, inventory/procurement, marketing, support/notifications, and admin governance (roles/permissions/settings/audit) — has models and no controllers, services, routes, or validation to read/write them. The user asked for a full inventory of what's left to build and a phased plan (not implementation) so work can proceed in deliberate, shippable stages instead of all at once.

## What Changes

- Inventory every API endpoint the current schema implies but doesn't yet have, grouped into 7 phases ordered by business dependency (you can't sell without a catalog; you can't checkout without a cart; etc.) — see `tasks.md` for the full phase-by-phase endpoint list.
- Define the behavior contract (spec) for each phase as its own capability, so each phase can be implemented and archived independently later without re-litigating scope.
- No code is written in this change — planning only, per the user's explicit request ("aj ke shob korbo na" / not doing it all today).

## Capabilities

### New Capabilities
- `api/catalog`: Admin CRUD + public browse/search for `Category`, `Brand`, `Product`, `ProductVariant`, `ProductAttribute`, `ProductImage`, `ProductCategory`.
- `api/cart-wishlist`: Guest+customer cart operations (add/update/remove/merge-on-login) and customer wishlist operations, plus `CustomerAddress` management.
- `api/checkout`: Order placement from cart, order status lifecycle, payment recording, shipping method/shipment tracking.
- `api/post-purchase`: Returns, refunds, and product reviews (including admin moderation).
- `api/inventory`: Admin-only warehouse/stock/stock-movement management and supplier/purchase-order procurement lifecycle.
- `api/marketing`: Admin CRUD for coupons, campaigns, and banners, plus coupon validation/application at checkout time.
- `api/support-and-admin`: Support tickets/messages, customer notifications, store settings read/update, RBAC (role/permission) management, and read-only audit log access.

### Modified Capabilities
<!-- None. This adds new API behavior on top of the existing, unchanged data model. -->

## Impact

- **Affected code**: entirely new `src/app/module/<domain>/` folders (route/controller/service/validation/interface files, following the existing `auth`/`user` module convention) plus new `router.use(...)` lines in `src/app/routes/index.ts`. No existing module is modified.
- **Sequencing**: `design.md` and `tasks.md` define the phase order and why; each phase is independently implementable and archivable — a later phase does not block an earlier one from shipping.
- **Not covered by this change**: actually writing any controller/service/route code (that's the future `/opsx:apply` work, phase by phase, per the user's explicit "not today"), and any capability not implied by an existing model (e.g. gift cards, multi-vendor — out of scope, matching prior changes' scope boundaries).
