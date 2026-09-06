## Context

See proposal.md — Why.

Three constraints shape the approach:

**The rename spans three repos that deploy separately.** `electrode-server` owns the columns, `electrode-admin` authors them, `electrode-nextjs` renders them. This change's planning home is the server, but the API response field names are the contract between all three, and renaming a response field is not backwards compatible.

**`price` is an overloaded word in this codebase.** Of ~417 matches across the three projects, only the product- and variant-owned ones are in scope. `OrderItem.unitPrice`/`totalPrice`, `CartItem` pricing, `Banner.price`/`discountPrice`, `CampaignProduct.discountValue`, and the `price` on a delivery zone in `StoreSetting.checkoutConfig` and on landing-page delivery zones are all different concepts. A blind find-and-replace across the repos would corrupt them.

**Two of the three columns are load-bearing for a security guard.** `product.service.ts` excludes `costPrice` from `PUBLIC_PRODUCT_SCALARS` and `product.validation.ts` excludes it from `PUBLIC_PRODUCT_SORT_FIELDS`; the comments on both record that the field was once being served to every anonymous caller. Both guards are written as allowlists naming the fields that *may* be public, which is what makes them safe to rename — a missed rename produces a compile error or a dropped field, not a silent leak.

## Goals / Non-Goals

**Goals:**

- One vocabulary for the three prices from the database column through to the label a merchant reads.
- No product loses its price. This is a rename of populated money columns on a live catalogue.
- The `purchasePrice` exclusion from public output is provably still in force after the rename, not merely assumed.
- Consistency validation (selling ≥ offer > purchase) lands with the rename rather than after it, since the confusing names are what let inconsistent data in.

**Non-Goals:**

- No change to how any price is *computed*. Campaign pricing, tax, delivery and coupon maths keep their current behavior; only the field they read from is renamed.
- No renaming of the derived `campaignPrice` attached to product responses, nor of order/cart/banner/delivery price fields (see Context).
- No API versioning. This is a breaking rename shipped as a coordinated deploy, not a `/v2` catalogue.
- No data backfill or correction of products that currently violate the new consistency rule — see Decision 5.

## Decisions

### Decision 1: Rename the physical columns, not just the Prisma field names

Prisma's `@map` would let the model read `offerPrice` while the column stays `price`, giving a zero-migration rename. Rejected: no field in this schema uses `@map` today (only four `@@map` model aliases exist, all in `auth.prisma` for Better Auth's fixed table names), so introducing field-level mapping here creates a schema where the model name and column name silently disagree for exactly three fields. The confusion this change exists to remove would move from the admin form into the database.

More concretely, `product.service.ts` runs raw SQL — the product search query selects `p.price::text` and the related-products query orders on `p."price"`. Raw SQL bypasses Prisma's mapping entirely, so under `@map` those queries would keep referring to `price` while the rest of the module says `offerPrice`. Renaming the column keeps one name everywhere and turns those two raw queries into things that must be found and fixed, which is what we want.

**Alternative considered:** add the new columns, dual-write, drop the old ones later. Appropriate for a rename that must survive a rolling deploy with mixed server versions. Rejected as disproportionate — this is a single-instance deployment and the admin/storefront must be redeployed for the field rename anyway, so a brief coordinated deploy is simpler than a three-phase migration.

### Decision 2: The migration uses `ALTER TABLE ... RENAME COLUMN`, hand-written

`prisma migrate dev` generates a `DROP COLUMN` + `ADD COLUMN` pair for a rename it cannot infer, which would set every price in the catalogue to NULL. The migration must be created with `--create-only` and hand-edited to six `RENAME COLUMN` statements, following the precedent in `migrations/20260830044311_make_banner_dynamic/migration.sql`, which carries a header comment explaining exactly why it was hand-edited.

The rename is index-safe: Postgres carries indexes and constraints across a column rename automatically, so no index needs recreating. It is also the reason this is a fast migration on a large table — a rename is a catalogue-only operation, no table rewrite.

The migration SQL must be reviewed before it runs on data. This is the one step in the change that can destroy something irrecoverable.

### Decision 3: `offerPrice` stays required; the other two stay optional

Matching today's nullability exactly (`price` NOT NULL, the other two nullable) keeps the migration a pure rename with no `SET NOT NULL` / `DROP NOT NULL` clauses, which is what makes it safe on populated data. It also happens to be the correct model: a product must have a price to be sold, but a product with no discount has no separate regular price to show, and a product whose supplier cost was never recorded still sells.

Note the consequence for the admin form: the field a merchant *must* fill in is `offerPrice`, not `sellingPrice`. A merchant who is not running an offer fills in `offerPrice` and leaves `sellingPrice` empty. That reads slightly oddly, and the form should say so in help text ("leave the regular price empty if this product is not on offer") rather than requiring both.

### Decision 4: `?sortBy=price` and `?minPrice`/`?maxPrice` — rename `sortBy`, keep the filter names

These are public query parameters, and the two cases differ.

`sortBy=price` must become `sortBy=offerPrice`, because `PUBLIC_PRODUCT_SORT_FIELDS` values are passed to Prisma's `orderBy` as column names — the value *is* the field name, so it cannot stay `price` once the column is renamed without adding a translation layer. The storefront already tolerates this: `resolveSort()` in `lib/product-sort.ts` falls back to the default for an unrecognised `?sort=` value and never forwards an unknown one, so a stale bookmark degrades to the default ordering rather than erroring.

`minPrice`/`maxPrice` keep their names. They are filter parameters whose values are numbers, not field names — the mapping from parameter to column happens in code (`where.price = { gte, lte }`), so only the right-hand side changes. Renaming them to `minOfferPrice`/`maxOfferPrice` would break every saved filtered listing for a purely cosmetic gain. The spec pins down what they filter on (`offerPrice`), which is the part that was ambiguous.

**Alternative considered:** accept `sortBy=price` as a permanent alias for `offerPrice`. Rejected — an alias means the old vocabulary survives in the API forever, which is what this change is removing. The graceful client-side fallback already covers the stale-bookmark case.

### Decision 5: Consistency validation applies to writes only, not to existing rows

The new rule (selling ≥ offer > purchase) is enforced in `product.validation.ts` on create and update. It is not applied retroactively: the catalogue may already contain products that violate it, precisely because the confusing names let them be entered that way, and failing their next unrelated edit would strand them.

The consequence is that a merchant editing an inconsistent legacy product will be forced to correct its prices before any other edit to that product can be saved — since a partial update is validated against the stored values (see the spec scenario). This is acceptable and arguably the point: it surfaces the bad data at the moment someone is already looking at that product.

Cross-field validation on a partial update means the update path must load the product's current prices before validating, rather than validating the payload in isolation. That is a real change to the update flow, not just a schema tweak.

### Decision 6: Order the work server-first, and land the guard test before the rename

Sequence: schema + migration → server code → verify the security guard → admin → storefront. The server is the contract; the two clients are mechanical once it is fixed.

The exception is the `purchasePrice` exclusion test. It should be written *before* the rename, asserting against `costPrice` on the current code, so it is known to pass for the right reason — a test written after the rename that passes may be passing because it asserts on a field name that no longer exists anywhere. Renaming the assertion along with the code then proves the guard survived.

## Risks / Trade-offs

**A generated migration drops the price columns instead of renaming them, zeroing every price in the catalogue.** → The single most damaging failure in this change. Use `prisma migrate dev --create-only`, hand-edit to `RENAME COLUMN`, and read the SQL before applying. Take a database backup first; `add-database-backup-restore` exists in this repo for exactly this kind of moment.

**A find-and-replace of `price` → `offerPrice` corrupts order, cart, banner or delivery pricing.** → The out-of-scope list in the proposal is explicit. Rename by symbol from the Prisma model outward (let the type checker find the call sites) rather than by text search across the repos. `tsc --noEmit` in all three projects is the completeness check.

**Raw SQL is invisible to the type checker.** → `product.service.ts` has two raw queries touching `p.price` (the search projection and the related-products score). Neither will fail to compile after the rename; both will fail at runtime. They must be found by grep against the raw query strings and covered by an actual request to `GET /products/search` and the related-products endpoint, not by a passing build.

**`purchasePrice` leaks into a public response.** → The guards are allowlists, so the likely failure is the opposite (a field wrongly dropped). Still, the explicit check: after the rename, assert that an unauthenticated `GET /products/:slug` response contains no `purchasePrice` at the product level *or* inside `variants[]`, and that `?sortBy=purchasePrice` is refused. The variant projection is a separate `select` and is easy to overlook.

**The three repos deploy out of step, and the storefront renders empty prices.** → Unavoidable with a breaking rename; mitigated by deploying together and keeping the window short. Any consumer outside these three repos (a mobile app, a partner integration) breaks with no mitigation available — flagged in the proposal's Impact as out of reach.

**Consistency validation rejects a save a merchant expects to succeed.** → Only for products already violating the rule. The error must name both offending fields, or the merchant will not know which of two numbers to change.

## Migration Plan

1. Back up the database.
2. Edit the two Prisma schema files; generate with `--create-only`; hand-edit the migration to six `RENAME COLUMN` statements; review the SQL.
3. Apply to a development database first and confirm prices survived — spot-check a product's three values before and after.
4. Land server code, verify the public-exclusion assertions, then admin, then storefront.
5. Deploy all three together.

**Rollback:** a column rename is symmetric, so the down path is six `RENAME COLUMN` statements in reverse plus redeploying the previous build of each app. This holds only while the rename is the sole schema change in the migration — do not fold unrelated schema edits into it, or rollback stops being reversible.
