## Context

See proposal.md — Why.

`StoreSetting` is a singleton row whose merchant-facing configuration is already split between typed scalar columns and a handful of Zod-gated `Json` blobs (`checkoutConfig`, `theme`, `mainNav`, `announcementBar`, …). Three properties of that arrangement constrain this change:

- **Zod is the only gate on a `Json` column.** Postgres does not constrain shape, so every write must route through `store-setting.validation.ts` and reads are correspondingly trusted. This is stated in the model's own doc-comment.
- **The public projection is an explicit allow-list.** `getPublicStoreSetting` names each field it exposes, so a new column is private until someone opts it in. That is deliberate and this change opts in one line.
- **`merge()` swaps the whole value.** A stored blob is either used entire or replaced entire by the default. `checkoutConfig` needed a bespoke `withDeliveryDefault` shim precisely because a blob stored before `delivery` existed came back missing a key the storefront needed.

## Goals / Non-Goals

**Goals:**

- Add the flags with no behavioural change to any existing store, before or after the migration.
- Keep the storefront's cost at zero additional requests — the flags ride the payload the root layout already fetches.
- Keep the blob's shape trivially forward-compatible, so adding a fourth flag later does not need another `withDeliveryDefault`.

**Non-Goals:**

- Gating the wishlist or compare **APIs** on the flags. Those endpoints stay open; see the decision below.
- Per-product or per-category overrides. These are shop-wide facts and belong on the singleton row, like `siteMode`.
- Any admin UI or storefront behaviour — those are the `admin` and `frontend` changes that depend on this one.

## Decisions

**One `catalogConfig` blob, not three scalar columns.**
Three `Boolean` columns would be typed by Postgres and need no Zod schema, which is genuinely simpler. Rejected anyway: the admin panel saves settings as disjoint field sets (`checkoutConfig` from one page, `theme` from another), and a page that owns *one JSON field* participates in that arrangement for free. Three loose columns would make the Catalog Settings page the only editor whose save touches multiple top-level fields, and every future flag would widen both the table and the update schema. The blob also groups them the way a merchant thinks of them — "what my product listings offer".

**Defaults are all-enabled, and the column is nullable with no backfill.**
A null column merges to `DEFAULT_CATALOG_CONFIG` on read, so existing rows need no migration data step and a fresh install behaves identically to today. The alternative — a non-null column with a database default — would have to be backfilled and would still not cover a row written before the column existed in a restored dump. Nullable-plus-merge is the pattern every other blob here already uses.

**Read the blob with a per-key merge, not `merge()`.**
`merge()` replaces a stored blob wholesale with the default, which is what forced the `withDeliveryDefault` shim onto `checkoutConfig` when a key was added later. Since this blob is a flat map of booleans and is certain to gain keys, it is read as `{ ...DEFAULT_CATALOG_CONFIG, ...(stored?.catalogConfig ?? {}) }` from the start. A row stored before a fourth flag exists then reports that flag at its default rather than arriving without it, and no shim is ever needed. This is the one place this change deliberately departs from the surrounding code, and it departs toward the behaviour that code had to be patched into.

**The flags govern presentation only; the wishlist and compare APIs stay live.**
Rejecting wishlist writes while the flag is off was considered and rejected on two grounds. First, the failure mode is bad: a shopper mid-session when a merchant flips the switch gets an error rather than a UI that has simply stopped offering the feature. Second, and decisive — it would make the flag destructive in effect. A merchant experimenting with the toggle would find, on turning it back on, that their shoppers' saved lists had been unreachable and possibly pruned in between. A presentation flag that quietly costs customer data is not a presentation flag. The spec states this as a requirement rather than leaving it to implementation.

**No new endpoint.**
`PATCH /settings` is already a partial upsert and `GET /settings/public` already carries the payload. Adding a field to both is the whole integration.

## Risks / Trade-offs

- **A JSON blob can drift from its TypeScript type, since reads are trusted** → mitigated by the same discipline as the existing blobs: the Zod schema is the sole write path, and the per-key merge above means a partial or stale stored value degrades to defaults rather than to `undefined`.
- **Opting a field into the public allow-list is a one-way door for privacy** → these are three booleans describing which UI a shop offers, all of which are trivially observable by loading the storefront. There is nothing here to leak.
- **The admin and frontend changes are blocked on this one** → intended; the field shape is settled here first so neither downstream change is written against a guess.

## Migration Plan

1. Additive migration adds the nullable `catalogConfig` column. Nothing else changes; the column is null everywhere.
2. Deploy. Every read merges null to all-enabled, so behaviour is identical to before the migration.
3. The admin and frontend changes ship afterwards and begin writing and reading the field.

Rollback is dropping the column: no code outside this module reads it until the downstream changes ship, and a store whose column is dropped reverts to all-enabled.
