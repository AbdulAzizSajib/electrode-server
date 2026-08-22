## Why

`add-core-api-endpoints` (archived) wired every one of the schema's 46 models to at least a basic endpoint, but a code-level audit turned up several places where a model/field exists and is API-settable, yet nothing in the codebase actually *reads* or *acts on* it: `StoreSetting.defaultTaxRatePercent`/`freeShippingThreshold` are never applied at checkout, `Stock.reservedQuantity` and the warehouse-scoped `Stock` ledger are never consulted by checkout (which still only reads Phase 1's denormalized `stockQuantity`), receiving a purchase order or adjusting stock never updates that denormalized total back, completing a return never restocks anything, and — despite having full read/moderation APIs — nothing anywhere ever creates a `Notification` or an `AuditLog` row. Separately, admin-managed image fields (`Category.image`, `Product.images[].url`, `Banner.image`, etc.) all expect an already-hosted URL, but no endpoint exists to actually upload a file and get one back — a real blocker for the admin panel the user is about to build.

This change closes the higher-priority half of that audit (the user's "Tier 1 + Tier 2" picks): image upload, tax/free-shipping application, stock-ledger reconciliation (including return-triggered restocking), and making Notification/AuditLog actually get written to. Payment gateway integration and transactional email (Tier 3) remain explicitly deferred — same posture as the prior change's Non-Goals.

## What Changes

- Add a generic admin/staff-only image upload endpoint (Cloudinary-backed, mirroring the existing avatar-upload pattern in `auth.controller.ts`) that returns a URL for the catalog/marketing admin UIs to use — no existing module's validation changes (they keep accepting a URL string).
- Checkout (`order.service.ts`) now applies `StoreSetting.defaultTaxRatePercent` to compute a real `taxAmount`, and treats the order as free-shipping once the subtotal meets `StoreSetting.freeShippingThreshold` (composing with the existing coupon-driven free-shipping case, not replacing it).
- Checkout's stock check and deduction move from the Phase 1 denormalized `Product`/`ProductVariant.stockQuantity` to the Phase 5 warehouse-scoped `Stock` ledger: available quantity is summed across all warehouses, and a single order line may be fulfilled by splitting the deduction across more than one warehouse (largest-stock-first) when needed — there is no "default warehouse" concept in the schema to pick just one. Each deduction writes a `StockMovement` (type `SALE`). The denormalized `stockQuantity` total is still decremented in lockstep so Phase 1's public read paths stay accurate.
- Receiving a purchase order and manually adjusting stock (`PATCH /stock/:id/adjust`) now also update the corresponding `Product`/`ProductVariant.stockQuantity` denormalized total, closing the sync gap the checkout change above depends on.
- Completing a return (`PATCH /returns/:id/status` -> `COMPLETED`) now restocks the returned item: increments `Stock.quantity` at an admin-specified warehouse and writes a `StockMovement` (type `RETURN`), mirroring how purchase-order receiving already works.
- A customer can now cancel their own order (`PATCH /orders/:id/cancel` or equivalent) while it is still `PENDING` or `CONFIRMED`, without needing staff to do it via the admin status endpoint.
- Key lifecycle events across the API now create a `Notification` for the affected user: order status changes (customer), payment recorded (customer), return status changes (customer), refund created (customer), review reply/moderation (customer), a new support-ticket message (the other participant), and stock dropping to/below `Product.lowStockThreshold` (OWNER/ADMIN).
- Admin-mutating actions across the platform now write an `AuditLog` entry (action, entity, entityId, before/after data where applicable): catalog CRUD, inventory CRUD + stock adjustments, marketing CRUD, order status changes, return/refund actions, review moderation, support ticket updates, RBAC (`Role`/`Permission`/`RolePermission`) changes, and store settings updates.

## Capabilities

### New Capabilities
- `api/media`: Admin/staff-only file upload (image -> hosted URL), backing the catalog/marketing admin UIs that currently only accept a URL string.

### Modified Capabilities
- `api/checkout`: order totals apply the store's tax rate and free-shipping threshold; stock validation/deduction reads and writes the warehouse-scoped `Stock` ledger (not just the denormalized total); a customer can cancel their own not-yet-fulfilled order; order status changes and payment recording notify the customer and are audit-logged.
- `api/inventory`: receiving a purchase order and adjusting stock keep the denormalized `Product`/`ProductVariant.stockQuantity` in sync with the `Stock` ledger; stock dropping to/below the low-stock threshold notifies OWNER/ADMIN; inventory admin mutations are audit-logged.
- `api/post-purchase`: completing a return restocks the item; return status changes, refund creation, and review moderation/replies notify the customer and are audit-logged.
- `api/support-and-admin`: a new support-ticket message notifies the other participant; admin-mutating actions across the platform (catalog, inventory, marketing, checkout, post-purchase, RBAC, settings) are recorded in the audit log, making the existing "audit logs are read-only and admin-scoped" requirement's implied write side real.

## Impact

- **Affected code**: new `src/app/module/media/` (or similarly named) upload module; edits to `order.service.ts`/`order.controller.ts`/`order.route.ts` (tax, free shipping, stock ledger, self-cancel), `stock.service.ts` and `purchase-order.service.ts` (denormalized-total sync), `return.service.ts` (restock on completion), and every existing admin-mutating service across catalog/inventory/marketing/checkout/post-purchase/support-ticket/role/store-setting modules (audit log write) plus the services that should notify (order/payment/return/refund/review/support-ticket/stock).
- **Not covered by this change**: real payment-gateway SDK integration (Stripe/bKash/etc.) and transactional email — both remain explicitly deferred, same as the prior change's Non-Goals.
- **Sequencing**: the four "Modified Capabilities" areas are largely independent of each other and of the new `api/media` capability; `tasks.md` will phase them so each is independently implementable/archivable, consistent with how `add-core-api-endpoints` was structured.
