## 1. Encryption and environment

- [x] 1.1 Add `INTEGRATION_ENCRYPTION_KEY` to `server/src/app/config/env.ts` — the `EnvConfig` interface, the return object, and the `requireEnvVariable` array — and verify the server refuses to boot with a clear message when it is unset (`pnpm --filter ./server dev` with the var removed).
- [x] 1.2 Create `server/src/app/lib/crypto.ts` with `encryptSecret` / `decryptSecret` (AES-256-GCM, random 12-byte IV, `v1:<iv>:<tag>:<ciphertext>` base64) per design Decision 2, and verify a round trip returns the original, a tampered ciphertext fails to decrypt, and an unknown version prefix is rejected.
- [x] 1.3 Write `server/scripts/verify-integration-crypto.ts` covering round trip, tamper rejection, wrong-key rejection, and unknown-prefix rejection; verify with `npx tsx scripts/verify-integration-crypto.ts`.
- [x] 1.4 Document `INTEGRATION_ENCRYPTION_KEY` (how to generate 32 random bytes base64) in the server env example/readme, stating that losing it makes every stored credential unrecoverable; verify the documented command produces a key the server accepts.

## 2. Schema and migration

- [x] 2.1 Add `prisma/schema/Integration.prisma` — `provider` as PK, `enabled`, `publicId` (unique), timestamps — with a `///` header comment recording why the enabled flag and publicId sit on the integration rather than on each credential row (design Decision 1); verify `npx prisma validate` passes.
- [x] 2.2 Add `prisma/schema/IntegrationCredential.prisma` — `provider`, `kind`, encrypted `value`, `lastFour`, timestamps, unique `(provider, kind)`, relation to `Integration` with cascade delete — with a `///` header comment stating why secrets live here and not on `StoreSetting`; verify `npx prisma validate` passes.
- [x] 2.3 Add `StoreSetting.integrationConfig Json?` with a `///` comment recording the public-vs-secret split from design Decision 7; verify `npx prisma validate` passes.
- [x] 2.4 Run `pnpm --filter ./server migrate`, then **delete every `DROP INDEX` line for `Product_name_trgm_idx`, `Product_sku_trgm_idx` and `Brand_name_trgm_idx` from the generated SQL and copy the NOTE block forward from the previous migration**; verify by grepping the new migration for `DROP INDEX` (must return nothing) and confirming the three indexes still exist in the database after applying.
- [x] 2.5 Write the one-time boot import: ensure an `Integration` row per registered provider, then fill any absent `(provider, kind)` credential row from the environment, never overwriting a merchant-entered value; wire it where `seedSuperAdmin` runs. Verify by running it twice against a database with env credentials set and confirming one row set, unchanged on the second run.

## 3. Integration module (server)

- [x] 3.1 Create `server/src/app/module/integration/` with `.interface.ts` declaring the credential descriptor shape from design Decision 4 (`kind`, `label`, `secret`), and verify it compiles.
- [x] 3.2 Implement `integration.service.ts`: list integrations with presence booleans and hints, upsert a credential, generate a webhook secret, toggle enabled. No `req`/`res` — verify scripts import it directly. Verify each function via a verify script.
- [x] 3.3 Implement `integration.validation.ts` (Zod) ensuring **no submitted secret is echoed in a validation error**; verify by submitting a malformed credential and confirming the error body contains no part of the value.
- [x] 3.4 Implement `integration.controller.ts` and `integration.route.ts` — `GET /integrations`, `PUT /integrations/:provider/credentials`, `PUT /integrations/:provider/webhook`, `PATCH /integrations/:provider` — all behind `checkAuth(OWNER, ADMIN)`; verify a STAFF token is refused and an OWNER token gets the listing.
- [x] 3.5 Register the routes in `server/src/app/routes/index.ts` with an accurate inline comment about mount ordering; verify `GET /api/v1/integrations` resolves.
- [x] 3.6 Add `AuditLogService.record(...)` after every credential write and toggle, with `userId` first per the module convention; verify an audit row appears after each mutation and that its payload contains no secret.
- [x] 3.7 Write `server/scripts/verify-integration-credentials.ts` (`__verify_*` rows, cleanup in `finally`) asserting: stored values are encrypted at rest, reads return only presence + hint, replacement discards the old value, and decrypt failure reports unconfigured rather than throwing.

## 4. Async provider contract

- [x] 4.1 Change `courier.provider.ts` so `isConfigured`, `isWebhookConfigured` and `webhookToken` return promises and `createConsignments` / `getStatus` / `getBalance` / `createReturnRequest` take resolved credentials, adding the credential descriptor to the interface and updating the header comment to record why credentials are passed in rather than fetched per adapter (design Decision 3); verify by type-checking — every call site must now error.
- [x] 4.2 Rework `steadfast.client.ts` to take credentials as arguments instead of reading `envVars`, and verify existing Steadfast behaviour is unchanged with `npx tsx scripts/verify-courier-provider.ts`.
- [x] 4.3 Update `steadfast.provider.ts` to the new contract, declaring its credential descriptor and resolving credentials from `IntegrationCredential` with env as fallback **only when no row exists**; verify a credential changed in the database takes effect on the next call with no restart, and that a merchant-entered value is never overridden by the env one.
- [x] 4.4 Update `manual.provider.ts` to the async contract (still declaring no capabilities, no credentials, and reporting itself configured); verify `npx tsx scripts/verify-courier-provider.ts` still asserts the capability/method correspondence.
- [x] 4.5 Update `courier.service.ts` for the new signatures — resolving credentials **once per dispatch run** and threading them through the batch loop — and verify dedupe, 50-per-batch persistence ordering, `matchResultsByInvoice` and `applyCourierStatus` are untouched by diffing the file and running `npx tsx scripts/verify-courier-dispatch.ts`.
- [x] 4.6 Update `courier.guard.ts` to resolve the expected webhook token asynchronously per provider, keeping constant-time comparison, refusal-when-unset, and `warnOnce`; verify with `npx tsx scripts/verify-courier-webhook-routing.ts` extended to cover a database-sourced token and a decrypt failure.
- [x] 4.7 Update `/courier/config` to report readiness from stored credentials; verify the endpoint reflects a credential added through the admin without a restart.
- [x] 4.8 Run the full existing courier verify suite (`verify-courier-{mapping,dispatch,provider,provider-switch,webhook-routing}.ts`) and confirm all pass unchanged.

## 5. Webhook callback URLs

- [x] 5.1 Add the `publicId`-carrying route `POST /webhooks/:provider/:publicId`, authenticated against that provider's stored secret; verify a valid secret is accepted and a mismatched one rejected with no shipment change.
- [x] 5.2 Confirm the legacy `POST /courier/webhook/:provider` route still authenticates against the same stored secret; verify with a request shaped like the pre-change one and assert the status is applied.
- [x] 5.3 Verify cross-provider rejection: a webhook for provider A carrying provider B's secret is refused (extend `verify-courier-webhook-routing.ts`).

## 6. Facebook Pixel and CAPI (server)

- [x] 6.1 Add `integrationConfig` validation to `store-setting.validation.ts` — `facebookPixel.pixelId` as `^\d{5,20}$`, and `facebookCapi.testEventCode` **required when `testMode` is true** — and verify both rejections return a message naming the expected format.
- [x] 6.2 Include `integrationConfig` in the public store-settings projection, and verify by asserting `GET /settings/public` contains the pixel id and contains no access token or courier credential.
- [x] 6.3 Implement the CAPI dispatcher: SHA-256 hashing of normalised email/phone, test-mode event code, `event_id` set to the order's id per design Decision 10, never throws — modelled on `utils/revalidateStorefront.ts`; verify a forced failure logs and returns rather than propagating.
- [x] 6.4 Call the dispatcher from order creation **without awaiting it**, and verify an order still completes when the dispatcher is made to hang or fail.
- [x] 6.5 Write `server/scripts/verify-facebook-capi.ts` covering: disabled sends nothing, missing token sends nothing, test mode attaches the code, non-test mode omits it, PII is hashed before send, and the event carries the order's id as `event_id`.

## 7. Admin panel

- [x] 7.1 Create `admin/src/lib/api/integrations.ts` (interfaces → fns → TanStack Query hooks) with keys in `query-keys.ts`; verify the listing hook receives presence booleans and never a secret value.
- [x] 7.2 Create `admin/src/features/ui/integrations/integrations-page.tsx` titled "Integrations" with the description "Manage courier and third-party integrations."; verify the page renders one card per integration.
- [x] 7.3 Build the shared integration-card shell (icon, title, subtitle, enable toggle, own Save button) and verify saving one card issues a request containing only that card's fields.
- [x] 7.4 Move the courier selection into a courier card, preserving the radio list, the `Current` badge, capability badges, the configuration notes, and the in-flight switch refusal message; verify switching while parcels are in transit still shows the server's count.
- [x] 7.5 Build the courier credentials sub-form **generated from the server's credential descriptor** (not hardcoded fields), masking every field marked `secret`; verify a failed save keeps every entered value and shows the reason.
- [x] 7.6 Build the webhook sub-form: read-only callback URL with copy, Generate button, enable toggle, and a warning that regenerating invalidates the previous secret; verify the generated value is displayed once and is never returned by a subsequent listing fetch.
- [x] 7.7 Build the Facebook Pixel card (pixel id + toggle + Save) and the Facebook CAPI card (toggle, test mode, pixel id, access token, test event code + Save); verify enabling test mode without a code is refused with the server's message.
- [x] 7.8 Rename the sidebar entry to "Integrations" at `/ui/integrations` in `admin/src/routes/nav-config.ts` **and** register the route in `admin/src/routes/app-router.tsx` behind the same `RoleGuard`; verify the sidebar entry navigates to a rendered page (both files — one alone does nothing).
- [x] 7.9 Add a redirect from `/ui/courier-settings` to `/ui/integrations` and verify the old path no longer 404s.
- [x] 7.10 Update the settings link in `admin/src/features/sales/courier/courier-page.tsx` to point at `/ui/integrations` with the label "Integrations"; verify the link resolves.
- [x] 7.11 Delete `admin/src/features/ui/courier-settings/` and verify `pnpm --filter ./admin build` passes with no dangling import.
- [x] 7.12 Add an unsaved-changes guard covering any dirty card and verify navigating away mid-edit warns.

## 8. Storefront

- [x] 8.1 Add the pixel fields to `nextjs/src/types/store-settings.ts` and merge them into `FALLBACK_SETTINGS` per-field, keeping the mirrored-limits obligation; verify a partial settings payload still yields a complete object.
- [x] 8.2 Render `FacebookPixel` from the `(shop)` layout when enabled and configured; verify no script is emitted when disabled or unconfigured.
- [x] 8.3 Implement the precedence rule — a landing page's own pixel wins, shop-wide is the fallback when it has none; verify a landing page with its own id emits exactly one pixel and one `PageView`.
- [x] 8.4 Fire `Purchase` on order confirmation through the existing no-op-safe helper, passing the order's id as `event_id`; verify the confirmation renders normally with `fbq` absent, and that the id sent matches the one the server sends.
- [ ] 8.5 Verify deduplication end to end in Meta test mode: place one order with both Pixel and CAPI enabled and confirm Events Manager shows one `Purchase`, not two; reload the confirmation and confirm the count does not increase.
  - **BLOCKED — needs a live Meta account.** Both halves are verified locally instead: `verify-facebook-capi.ts` asserts the server sends `event_id: <order id>`, and `FacebookPixel.test.ts` asserts the browser sends the same value as `eventID`, including on a repeat call. The remaining step is confirming Meta honours the match, which only Events Manager can show.
- [x] 8.6 Run `pnpm --filter ./nextjs build` and `pnpm --filter ./nextjs test` and confirm both pass.

## 9. Documentation and final verification

- [x] 9.1 Update the `///` comment on `StoreSetting.courierProvider` to say credentials now live in `Integration` / `IntegrationCredential` rather than the environment, keeping the prohibition on secrets on that row intact; verify the comment matches the shipped behaviour.
- [x] 9.2 Update the header comments in `courier.provider.ts` and `providers/index.ts` to reflect the async credential contract and the credential descriptor; verify no comment still claims credentials come from the environment.
- [x] 9.3 Update the courier section of the root `CLAUDE.md` — credentials are merchant-editable and encrypted, the admin page is now UI → Integrations, and adding a courier is still one adapter plus one registry entry; verify every path and page name in that section is accurate.
- [x] 9.4 Run `pnpm build` (server → admin → shop) and confirm all three build, including `scripts/fix-imports.js` on the server.
- [x] 9.5 Run every `server/scripts/verify-*.ts` touched or added by this change and confirm all pass with no `__verify_*` rows left behind.
- [x] 9.6 Run `openspec validate rename-courier-setting-to-integrations --strict` and confirm it passes.

## 10. The enable/disable switch actually switches

- [x] 10.1 Gate dispatch, balance and returns on `IntegrationService.isEnabled` in `assertConfigured`, with a refusal that says "switched off" rather than "not configured"; verify with `npx tsx scripts/verify-integration-enabled.ts`.
- [x] 10.2 Refuse switching off the courier the shop currently dispatches through, naming the way out; verify the integration stays enabled after the refusal.
- [x] 10.3 Report `enabled` from `/courier/config` and make the admin's courier picker refuse to offer a disabled courier; verify the admin builds and the note explains the state.
- [x] 10.4 Leave reconciliation deliberately ungated so parcels already in transit keep being tracked, and record why in a comment; verify with the same script.
- [x] 10.5 Write `server/scripts/verify-integration-enabled.ts` covering the refusals, credential survival, and the config report; verify all checks pass and no rows are left behind.
