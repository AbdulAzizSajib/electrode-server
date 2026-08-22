# Marketing Specification

## Purpose

Lets admins run promotions (coupons, campaigns, banners) and lets the checkout flow apply them correctly.

## Requirements

### Requirement: A coupon is validated against its own rules before being applied
Applying a coupon code to a cart SHALL check `status`, `startsAt`/`expiresAt`, `usageLimit` vs `usageCount`, `perCustomerLimit`, `minimumOrderAmount`, and (if `CouponProduct` rows exist for it) that at least one eligible product is in the cart — before any discount is calculated.

#### Scenario: Expired coupon
- **WHEN** a customer applies a coupon whose `expiresAt` has passed
- **THEN** the coupon is rejected with a specific reason, and the cart's totals are unaffected

#### Scenario: Coupon scoped to specific products
- **WHEN** a customer applies a coupon that has `CouponProduct` rows and none of those products are in the cart
- **THEN** the coupon is rejected as not applicable to the current cart

### Requirement: Campaign discounts apply automatically to eligible products, no code required
Unlike coupons, an active `Campaign`'s `CampaignProduct` discount SHALL be reflected in a product's displayed/checkout price automatically whenever the campaign is `ACTIVE` and within its `startsAt`/`endsAt` window — no customer action needed.

#### Scenario: Campaign becomes active
- **WHEN** a `Campaign`'s `startsAt` is reached and its status is `ACTIVE`
- **THEN** its tagged products' prices reflect the campaign discount without any per-order action

### Requirement: Only active, in-window banners are publicly served
The public banner listing SHALL exclude banners that are not `ACTIVE` or are outside their `startsAt`/`endsAt` window, ordered by `sortOrder`.

#### Scenario: Scheduled banner not yet live
- **WHEN** a `Banner` has `status: ACTIVE` but `startsAt` in the future
- **THEN** it does not appear in the public banner listing yet
