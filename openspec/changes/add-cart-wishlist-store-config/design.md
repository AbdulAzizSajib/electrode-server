## Context

This builds on the now-valid schema from `fix-prisma-schema-relations` (40 models, zero `prisma validate` errors) and the gaps documented visually in `add-schema-erd-diagram`'s "Known gaps" section. All four capabilities here are purely additive to the schema: no existing column is dropped, retyped, or made required. See `proposal.md` for what/why; this covers how.

## Goals / Non-Goals

**Goals:**
- Schema support for: guest+customer cart with login-time merge, per-customer wishlist, singleton store settings (currency + flat tax + shipping threshold + contact info), and additive multi-category tagging for products.
- Every new relation ships with its opposite field from day one (no repeat of the `fix-prisma-schema-relations` cleanup work).
- Zero breaking changes — additive only, so no phased/nullable-then-required migration dance is needed.

**Non-Goals:**
- Not building the API endpoints, guest-cookie handling, cart-merge business logic, or admin UI for any of this — this change is schema-only. Follow-up implementation changes will consume these models.
- Not a multi-currency system (multiple currencies active at once) — single configured currency only.
- Not a tax-rules engine (per region/category/product tax rates) — one flat default rate only.
- Not replacing `Product.categoryId`/`category` — that stays as the primary/canonical category; this only *adds* a many-to-many for supplementary categorization.
- Not building gift cards, coupons-on-cart validation, or cart price/stock re-validation logic — schema only, no behavior.

## Decisions

### Decision: Cart identity is `customerId XOR guestToken`, both optional+unique, not a required discriminator column
**Options considered:**
- (a) `Cart.customerId String? @unique` + `Cart.guestToken String? @unique`, with the "exactly one must be set" rule enforced in application code (not the database).
- (b) A required `type` enum (`GUEST`/`CUSTOMER`) plus the same two optional columns, enforced by a CHECK constraint.

**Choice: (a).** Prisma/PostgreSQL don't make a clean cross-column CHECK constraint ("customerId is set XOR guestToken is set") expressible directly in the Prisma schema DSL — it would need a raw SQL migration addition. Given this is a low-risk, application-layer-enforced invariant (identical in spirit to how `Order.shippingAddressId` or other optional FKs are already handled unenforced-at-DB-level elsewhere in this schema), keeping it simple with two unique-optional columns and enforcing "exactly one" in the cart-creation service code (future work) is consistent with the codebase's existing conventions and avoids introducing raw SQL into an otherwise pure-Prisma-DSL schema.

**Trade-off accepted:** The database itself won't reject a `Cart` row with both or neither set — that's a follow-up implementation-layer responsibility, tracked as a task-list note, not a schema-level guarantee.

### Decision: `guestToken` is an opaque string column, not a relation to `Session`
The guest identity is deliberately NOT tied to better-auth's `Session` model. A guest browsing without any auth session at all (common — most anonymous visitors never create a `Session` row) still needs a cart. `guestToken` is a random opaque string the API layer will mint and set in a plain (non-auth) cookie — unrelated to login sessions. This keeps cart identity independent of the auth system entirely, which is simpler and matches how most e-commerce platforms separate "cart identity" from "auth identity."

### Decision: `StoreSetting` is a typed singleton row, not a generic key-value config table
**Options considered:**
- (a) A generic `Setting { key String @id, value String }` table (EAV-style).
- (b) A single typed `StoreSetting` model with fixed, named columns and a fixed `id`.

**Choice: (b).** The schema already avoids generic EAV patterns for structured, known-shape data (e.g. `ProductAttribute` is the one exception, and it's for genuinely open-ended product-specific key/value pairs, not fixed site config). A typed singleton gives compile-time field safety in Prisma Client (`storeSetting.currency`, not `settings.get('currency')` with string parsing) and matches the existing schema's overall style. The "singleton" invariant (never zero or more than one row) is enforced by giving the row a fixed, well-known `id` (`"singleton"`) and having all reads/writes go through an `upsert` keyed on that id — the same fixed-id pattern already used for seeded `Role` rows in `fix-prisma-schema-relations`.

### Decision: Multi-category is additive (`ProductCategory` join table alongside existing `categoryId`), not a replacement
Replacing `Product.categoryId` outright (like the `User.role` migration) would be another breaking, multi-step migration for a feature that doesn't strictly require removing the existing column — a product can perfectly well keep one "primary" category (used for its canonical URL/breadcrumb, exactly as today) while also being taggable into additional categories via a new join table. This delivers the requested capability (a product discoverable from more than one category page) with zero risk to existing category-listing code paths, at the cost of two ways to associate a product with a category existing side-by-side (primary FK + join table) — considered an acceptable, common real-world trade-off (e.g. Shopify's "product type" + "collections" split).

## Risks / Trade-offs

- **[Risk] `Cart` identity invariant (`customerId` XOR `guestToken`) isn't DB-enforced.** → Mitigation: documented above; the future cart-service implementation must enforce it at creation time; flagged as a follow-up task, not silently assumed solved by the schema alone.
- **[Risk] Merging a guest cart into an existing customer cart on login needs care to avoid data loss or duplicate line items.** → Mitigation: `commerce/cart` spec explicitly requires quantity-combining on merge (not duplication); this is a behavior contract for the future implementation to satisfy, not something the schema alone guarantees.
- **[Risk] Two-category-mechanisms-at-once (`categoryId` + `ProductCategory`) could confuse future contributors about which one is authoritative for what.** → Mitigation: `catalog/product-categorization` spec and the Prisma schema comments state explicitly that `categoryId` remains primary/canonical and `ProductCategory` is supplementary only.
- **[Risk] Single flat tax rate / single currency may need revisiting if the store expands beyond Bangladesh or needs category-specific tax treatment.** → Accepted as an explicit, documented scope boundary (not a silent gap) — revisit as a separate future change if/when the business actually needs it.

## Migration Plan

Purely additive: new tables (`Cart`, `CartItem`, `Wishlist`, `WishlistItem`, `StoreSetting`, `ProductCategory`) plus new nullable/optional relation fields on `Customer`, `Product`, `ProductVariant`, `Category`. A single `prisma migrate dev` run covers all of it — no phased rollout needed (contrast with the `User.role` migration in `fix-prisma-schema-relations`, which required a nullable-then-required phased approach because it changed an existing column). A seed step creates the one `StoreSetting` singleton row with defaults on first run.
