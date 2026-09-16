## 1. Schema and migration

- [x] 1.1 Add a nullable `faviconUrl String?` column to `StoreSetting` in `prisma/schema/StoreSetting.prisma`, in the Branding block beside `logoUrl` and `footerLogoUrl`. Doc-comment it the way its neighbours are: it is an ADDRESS, not a file; null means "no icon chosen" and is deliberately not a copy of the storefront's shipped icon path (design.md Decision 2); the storefront owns the fallback because it owns that asset.
- [x] 1.2 Generate the additive migration and run `npm run generate`. No backfill.

  `20260916061247_add_favicon_url`, one statement: `ALTER TABLE "StoreSetting" ADD COLUMN "faviconUrl" TEXT;`. **No spurious `DROP INDEX` this time** — nothing to strip, because the three trgm indexes were no longer in the database for Prisma to read as drift (see below). Applied with `migrate deploy`; column verified present as nullable `text`.

  **Two environment findings, neither caused by this change:**

  1. **`prisma.config.ts`'s comment is wrong about the direct host.** It says "the pooler host is the only one this Neon project resolves". `ep-plain-bar-azvk3ikx.c-3.…` (without `-pooler`) resolves fine. Not corrected here — it is not this change's file to edit — but it is worth a follow-up.

  2. **A stale Prisma migration advisory lock is stuck on a pooled backend.** `migrate deploy` failed twice with `P1002 … pg_advisory_lock(72707369)`, through both the pooled and the direct host. `pg_locks` shows the lock held by a pgbouncer-owned backend whose client is long gone; pgbouncer keeps the session alive, so the session-scoped lock is never released, and it cannot be released from another session. Worked around with `PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK=true`, which is Prisma's documented answer for pooled connections. **Every future migration will hit this** until that backend is recycled — clearing it needs `pg_terminate_backend` on the holding pid, which was not done because it is someone's database to decide about.

  Also note `DIRECT_DATABASE_URL` is not set in `server/.env`, so migrations run against `channel_binding=require` and hit the documented misleading `P1001`. Supplied inline for these commands rather than editing `.env`.

  **PRE-EXISTING REGRESSION, OUT OF SCOPE, REPORTED NOT FIXED:** all three trgm indexes — `Product_name_trgm_idx`, `Product_sku_trgm_idx`, `Brand_name_trgm_idx` — are **absent from the database**. `20260915093244_change_cuid_to_uuid_7/migration.sql` drops all three at lines 2, 5 and 8 and never recreates them: exactly the failure `20260907013258_add_order_item_unit_cost` and `20260914120000_remove_collections` both left standing notes warning about. `pg_trgm` is still installed. `ProductService.searchProducts` is therefore running sequential scans today. Recreating them is its own change.

## 2. Favicon: validation, defaults and public projection

- [x] 2.1 Add `faviconUrl: z.url("Favicon URL must be valid").max(500).optional()` to `updateStoreSettingZodSchema` in `store-setting.validation.ts`, in the Branding group beside the two logo URLs. `.optional()` alone, not `.nullable()` — an omitted key means "leave unchanged" under the partial upsert, the same as every other branding scalar.
- [x] 2.2 Add `faviconUrl: null as string | null` to `DEFAULT_PUBLIC_SETTINGS` in `store-setting.constant.ts`, beside `logoUrl`/`footerLogoUrl`, with a comment on why null rather than the shipped icon's path.
- [x] 2.3 Opt `faviconUrl` into the public payload in `getPublicStoreSetting` — one line, `merge(stored?.faviconUrl, DEFAULT_PUBLIC_SETTINGS.faviconUrl)`, beside the logo fields. A scalar, so `merge` is correct here and no per-key repair is needed. Keep the allow-list an allow-list: add nothing else.
- [x] 2.4 Confirm a `PATCH /settings` carrying only `faviconUrl` leaves `logoUrl`, `footerLogoUrl`, the brand modes and `theme` untouched, and that the admin read returns the new column.

  Verified over HTTP against a running server, authenticated as the seeded super admin. The admin read returns the column; the favicon-only patch changed nothing else. See 5.1 for the full before/after.

  **This task also uncovered a gap that blocks section 7 below — a favicon can be set but never cleared.**

## 3. Newsletter as a home section

- [x] 3.1 Append `"NEWSLETTER"` to `HOME_SECTION_KEYS` in `store-setting.constant.ts`, **after `"BLOG"`** — last, because that is where the block renders today relative to the rest of the page (design.md Decision 3). `DEFAULT_HOME_CONFIG` is derived from this array and needs no edit.
- [x] 3.2 Extend the `HOME_SECTION_KEYS` doc-comment's mirror list so it still names both hand-maintained copies accurately — `frontend/src/services/store-settings.ts` (`FALLBACK_SETTINGS.homeConfig`) and `admin/src/lib/api/store-settings.ts` (`HOME_SECTION_REGISTRY`) — and note that both are updated by their own changes, which cannot be done from this repository. (The existing comment cites the frontend path as `nextjs/src/...`; correct it while here.)
- [x] 3.3 Confirm `reconcileHomeConfig` needs no change at all: a stored list that ends at `BLOG` must read back ending `BLOG, NEWSLETTER`, enabled, and a list that omits several sections must keep the merchant's own order with `NEWSLETTER` spliced at the end. Verify against a real read rather than by inspection — the splice is registry-relative and this is the first section added since it was written (design.md Decision 4).
- [x] 3.4 Confirm `homeConfigSchema` accepts `NEWSLETTER` and still rejects an unknown key, since both come from the same registry constant.

## 4. Postman collection

- [x] 4.1 Add `faviconUrl` to the admin `PATCH /settings` request body in `postman/Ecom.postman_collection.json`, and to the public settings request's documented payload (that request has no saved example response — its description is what documents the payload).
- [x] 4.2 Add `NEWSLETTER` to the documented `homeConfig` key set in the same collection, wherever the section keys are listed.

  `homeConfig` **was not documented in the collection at all** — there was no key set to add to. Added it properly instead: the full ordered list in the admin `PATCH` example body, plus the closed key set, the reconciliation rule and the rejection rules in that request's description, and the same key set in the public request's description. This is a gap that predates the change, not something it introduced.

- [x] 4.3 Run `npx tsx scripts/verify-postman-routes.ts` from `server/` and confirm it exits 0.

  **It did not, at first — and the first reading of it here was wrong.** Piping the script into `tail` and then reading `$?` reports *tail's* status, not the script's, so an earlier note in this file recorded "exits 0" when the script was actually exiting 1. Read with `${PIPESTATUS[0]}`, or without a pipe, it exited **1**.

  The failure was **pre-existing and unrelated to this change** — confirmed by stashing the collection and running the script against the committed version, which fails identically. `Admin - List Fonts` stored its query string inside the Postman `path` array (`"path": ["fonts?page=1&limit=10"]`) instead of using the `query` field, so the script read the route as `/fonts?page=1&limit=10`, reported it as documented-but-404, and separately reported the real `GET /fonts` as undocumented. It was the only request in all 310 shaped that way; every other paginated request uses `path: ["brands"]` + `query: [...]`.

  **Repaired**, because 4.3's acceptance criterion cannot be met otherwise: that one request now follows the same convention as its neighbours. Out of scope strictly speaking, one request touched, no route or behaviour changed.

  Now exits **0**. It still lists routes present on the server but absent from the collection — analytics, backup, integrations, seo, storage, refunds, purchase-orders, stock, audit-logs, notifications — all pre-existing, none of them settings routes, and not a failure condition for this script (it exits non-zero only on the reverse direction).

## 5. Verification

Happy path only, extending the existing script rather than introducing a test runner — the server has no unit test framework. Both checks run against a live database.

**Correction to the note above, and to design.md:** `verify-site-settings.ts` is **not** a live-database script. Its own header says "Pure functions only — no database, no network", and it contains zero `prisma` or `fetch` references. The tasks below were written assuming otherwise. They were split accordingly: the pure assertions went into that script, and the end-to-end checks it cannot express were run by hand against a running server and recorded here.

- [x] 5.1 Extend `scripts/verify-site-settings.ts` with the favicon round-trip: an unconfigured row reports `faviconUrl` as null on `GET /settings/public`; a `PATCH` setting it round-trips on both the public and admin reads; the logo columns are unchanged by that write.

  Split in two. **In the script** (pure, five checks): a valid URL is accepted, a malformed one and an over-500-character one are refused, `DEFAULT_PUBLIC_SETTINGS.faviconUrl` is null, and a favicon-only patch parses to a favicon-only object.

  **By hand against a running server**, because the projection is inline in a `prisma`-reading function and cannot be unit-tested: `GET /settings/public` carries `faviconUrl` and reports it as `null` for the unconfigured row; a `PATCH` of only `faviconUrl`, authenticated as the seeded super admin, round-trips on both the admin and public reads while `logoUrl`, `footerLogoUrl`, `headerBrandMode`, `footerBrandMode`, `headerLogoHeight` and `theme.brand` all stay exactly as they were. The row was restored to `faviconUrl: null` afterwards.

- [x] 5.2 Extend the same script with the reconciliation case: a `homeConfig` stored WITHOUT `NEWSLETTER` reads back with it, enabled, in last position, and with the stored sections' own order intact. This is the assertion that proves the no-backfill claim in the proposal.

  Ten checks in the script, over the real exported `reconcileHomeConfig`: registry ends in `NEWSLETTER`; `DEFAULT_HOME_CONFIG` carries it enabled and last; the schema accepts it and still refuses an unknown key and a duplicate; a pre-release list reads back with it appended and every other section untouched; a **reordered, partial** list keeps the merchant's order and still gets it last; a switched-off section is not re-enabled; and a stored `NEWSLETTER: false` is not overwritten by the splice.

  **Confirmed end-to-end on the real row, which is the strongest form of this claim available:** the stored `homeConfig` in the database is a genuine pre-release configuration — 11 keys, no `NEWSLETTER` — and `GET /settings/public` serves 12 with `NEWSLETTER` last and enabled. No migration was written to that column.

- [x] 5.3 Run `cd server && npx tsx scripts/verify-site-settings.ts` and record the result in this file.

  Exit 0, "All checks passed" — all 15 new checks plus every pre-existing one. `npx tsc --noEmit` also exits 0.

## 7. BLOCKER found during 2.4: a favicon can be set but never cleared

Raised rather than absorbed, because closing it changes this change's spec and both client changes' specs.

`faviconUrl` is `z.url().max(500).optional()`, copied from `logoUrl` and `footerLogoUrl`. Under the partial upsert an omitted key means "leave unchanged", so "remove this" has no representation at all:

- `{"faviconUrl": ""}` → rejected, `"Favicon URL must be valid"` (`z.url()` refuses the empty string)
- `{"faviconUrl": null}` → rejected, `.optional()` is not `.nullable()`
- omitting the key → the stored URL survives

Both verified over HTTP. The admin compounds it: `site-settings-page.tsx:330-331` sends a logo only `if (value.logoUrl.trim())`, so the existing **Clear** button empties the form field and then omits the key — the artwork is never actually removed. **This is a live bug for `logoUrl` and `footerLogoUrl` today**, not something this change introduced; `faviconUrl` inherits it by following the same pattern.

It matters here because two specs already written promise clearing works:
- `add-favicon-and-newsletter-section-admin`, "Browser Tab Icon Editor" — scenario *Administrator clears the tab icon* → "the setting is cleared"
- `add-favicon-and-newsletter-section-ui`, "The browser-tab icon is merchant-owned" — the whole "merchant has chosen no icon" fallback is only reachable for a store that never set one

The in-repo precedent for exactly this is `freeShippingThreshold`, which is `.nullable()` specifically so a merchant can withdraw a value under a partial upsert, and whose comment says so.

- [x] 7.1 Decide the fix with the user — recommended: make `faviconUrl` `.nullable()`, have the service write `null` through, and have the admin send `faviconUrl: null` when the field is empty rather than omitting it. Roughly a one-line validation change plus the admin's save.

  **Chosen and done.** `faviconUrl` is now `z.url().max(500).nullable().optional()`. The service needed no change: `updateStoreSetting` passes the validated payload straight into `upsert`, and Prisma writes an explicit `null` through to a nullable column.

  Verified over HTTP end to end: set → `faviconUrl` reads back on both the admin and public reads; `PATCH {"faviconUrl": null}` → both read `null`; `logoUrl` unchanged throughout. Two more checks in `verify-site-settings.ts` cover it (null accepted, empty string still refused). The row was left at `null`, as found.

  Documented in three places so the difference from the logo fields does not read as an accident: the Zod field, the Prisma column, and the Postman `PATCH` description — which now says `faviconUrl` is the second key on the endpoint accepting `null`, alongside `freeShippingThreshold`, and that the logo URLs accept no such thing.

  **The admin half is NOT done here** — `add-favicon-and-newsletter-section-admin` must send `faviconUrl: null` when the field is empty rather than omitting it, or its Clear button will silently do nothing exactly as the logos' do. Task 2.5 of that change says "send only when non-empty" and is now wrong; it needs updating before that change is applied.

- [x] 7.2 Decide separately whether `logoUrl`/`footerLogoUrl` get the same treatment. They have the identical bug today; fixing only the favicon leaves two Clear buttons that still silently do nothing. This is scope beyond the change as planned, which is why it is a question and not a task.

  **Decided: not here.** Left as a live bug, recorded rather than absorbed. Clearing a header or footer logo through the admin still does nothing — the field empties, the key is omitted, the stored URL survives — and both the Zod field and design.md now say so at the point someone would copy the pattern. It wants its own change, touching `logoUrl`/`footerLogoUrl` validation plus the admin's `save()`, because it alters behaviour for a field this change was not asked to touch.

## 6. Hand-off

- [x] 6.1 Confirm the server is safe to deploy ahead of both clients: an old admin panel never sends `faviconUrl` and never writes `NEWSLETTER`; an old storefront ignores `faviconUrl` and renders nothing for a section key it does not recognise, keeping its footer newsletter. Note anything found that contradicts this in design.md, Migration Plan.

  Checked against the clients as they stand today. **Safe, with one correction to how the claim was worded.**

  - Admin: `faviconUrl` appears nowhere in `site-settings-page.tsx`, so nothing sends it. `NEWSLETTER` appears nowhere in `admin/src/lib/api/store-settings.ts`, so the registry mirror does not carry it.
  - Storefront: renders `rendered[section.key]` inside a keyed `Fragment`. `NEWSLETTER` is not a key of that map, so the lookup is `undefined` and React renders nothing — no crash, no gap. `Footer.tsx` still references `NewsletterForm`, so the newsletter keeps rendering where it always did.

  **Correction to the wording, not to the conclusion:** "an old admin never *writes* `NEWSLETTER`" understates it. The old admin filters the stored list against its registry and writes the filtered list back, so a merchant who saves Home Sections on the old panel **strips `NEWSLETTER` out of the stored column**. That is harmless *only in this window*: reconciliation splices it back, enabled, on the next read, and the merchant had no way to switch it off on the old panel, so there is no choice to lose. It stops being harmless the moment the storefront change ships without the admin change — then a merchant saving Home Sections would silently re-enable a section they had turned off. This is the same hazard 6.2 records, seen from the other side, and it is why the admin's registry line is that change's first task.
- [x] 6.2 Note in this file that `add-favicon-and-newsletter-section-ui` (frontend) and `add-favicon-and-newsletter-section-admin` (admin) are unblocked, and that the admin one MUST land its `HOME_SECTION_REGISTRY` mirror — without it the admin drops `NEWSLETTER` as unrecognised on the next save and silently discards the merchant's choice.

  **Both are unblocked.** The API now serves `faviconUrl` and a `homeConfig` carrying `NEWSLETTER`; neither client change has a dependency left.

  Three things the client changes must carry, two of which their planning artifacts do not yet say:

  1. **The admin's `HOME_SECTION_REGISTRY` mirror is not optional.** Confirmed absent today. Until it lands, Home Sections filters `NEWSLETTER` out and writes the shortened list back on any save — currently harmless (see 6.1), and actively destructive the moment the storefront starts rendering the section. It is already task 1.1 of that change.
  2. **`add-favicon-and-newsletter-section-admin` task 2.5 is now WRONG and must be revised before that change is applied.** It says to send `faviconUrl` "only when non-empty", copying the logo pattern. That is exactly the bug found in 7.1: an empty field would omit the key, and Clear would silently do nothing. It must send `faviconUrl: null` when the field is empty. Not edited from here — that file belongs to the admin repo and this apply is scoped to the server.
  3. **That change's spec scenario "Administrator clears the tab icon" is now satisfiable**, which it was not when it was written. The server accepts `null`; the admin has to send it.

  Nothing in the storefront change needs revising — it only reads `faviconUrl` and treats null as "fall back to the shipped icon", which is exactly what the API now serves.
