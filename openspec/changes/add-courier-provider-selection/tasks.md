## 1. Schema and enum

- [x] 1.1 Add a `CourierProvider` enum to `prisma/schema/enums.prisma` with `STEADFAST` and `MANUAL`, documented with a `///` comment explaining that a value here must have a registered adapter — verify `prisma generate` emits the enum into `src/generated/prisma/client`
- [x] 1.2 Add `courierProvider CourierProvider @default(STEADFAST)` to `StoreSetting.prisma` with a `///` comment stating that the *selection* is safe on this public row while credentials are not (design Decision 8) — verify the field appears in the generated client
- [x] 1.3 Add `courierProvider CourierProvider @default(STEADFAST)` to `Shipment.prisma` with a `///` comment explaining that routing follows the consignment, not the setting, and what breaks if it does not (design Decision 3) — verify the field appears in the generated client
- [x] 1.4 Replace `Shipment.consignmentId`'s standalone unique constraint with a composite unique on `(courierProvider, consignmentId)` — verify the generated client exposes the composite selector used by webhook lookup
- [x] 1.5 Run `pnpm --filter ./server migrate`, then open the generated SQL and **delete the three `DROP INDEX` lines** for `Product_name_trgm_idx`, `Product_sku_trgm_idx` and `Brand_name_trgm_idx`, carrying forward the NOTE block from the most recent migration — verify by grepping the new migration for `DROP INDEX` and getting no hits
- [x] 1.6 Verify existing rows are correct under the defaults: query a pre-existing shipment with a consignment and confirm `courierProvider` reads `STEADFAST` with no backfill script run

## 2. Provider interface and registry

- [x] 2.1 Create `src/app/module/courier/courier.provider.ts` defining `ICourierProvider` (dispatch, status-by-consignment, optional balance, optional return) and `ICourierCapabilities` (`dispatch`, `status`, `balance`, `returns`, `webhook`), moving `CourierResult<T>` here unchanged from `steadfast.client.ts` — verify `pnpm --filter ./server lint` and `tsc` pass
- [x] 2.2 Write the file's header comment explaining that the interface was extracted from a working client rather than designed ahead of a second one, and that providers translate while the service orchestrates (design Decisions 1 and 2)
- [x] 2.3 Create `src/app/module/courier/providers/steadfast.provider.ts` adapting the existing `SteadfastClient` to `ICourierProvider`, declaring all five capabilities, and owning Steadfast's mapping (`courier.mapper.ts`) and status vocabulary (`courier.status.ts`) — verify `steadfast.client.ts` itself is unchanged in behaviour
- [x] 2.4 Create `src/app/module/courier/providers/manual.provider.ts` declaring no capabilities, with a header comment explaining why it is a provider rather than a null selection (design Decision 6) — verify every capability reads false
- [x] 2.5 Create the registry mapping each `CourierProvider` enum value to its adapter, and a `resolveProvider(provider)` that throws a clear error for an unregistered value — verify an enum value with no adapter fails loudly rather than returning undefined

## 3. Service routes to providers

- [x] 3.1 Replace `courier.service.ts`'s direct `SteadfastClient` import with provider resolution, reading `StoreSetting.courierProvider` for dispatch only — verify no `steadfast` identifier remains in `courier.service.ts`
- [x] 3.2 Add a capability gate at the service boundary refusing an unsupported action with a message naming the provider and the action — verify a balance request under `MANUAL` is refused rather than attempted
- [x] 3.3 Record `courierProvider` on the shipment in `recordDispatchedConsignment`, and include the provider in the dispatch audit entry — verify a dispatched shipment carries the provider that created it
- [x] 3.4 Route `reconcileQuietConsignments` on each shipment's stored `courierProvider` rather than the configured one, reporting (not skipping) a consignment whose creating provider has no usable credentials — verify with a shipment whose provider differs from the setting
- [x] 3.5 Route `createReturnRequest` on the consignment's creating provider and gate it on that provider's `returns` capability — verify a return under a provider without the capability is refused, naming it
- [x] 3.6 Confirm the orchestration guarantees are untouched: dedupe-before-anything, eligibility ordering, `BATCH_SIZE` 50 with persist-between-batches, `matchResultsByInvoice`, and the single `applyCourierStatus` both status paths converge on — verify `npx tsx scripts/verify-courier-dispatch.ts` and `verify-courier-mapping.ts` pass unchanged

## 4. Provider switching guard

- [x] 4.1 Add a check to the store-setting service refusing a `courierProvider` change while any non-terminal consignment exists under the current provider, with the message naming the in-flight count (design Decision 4) — verify the refusal message contains the number
- [x] 4.2 Treat `unknown` as in-flight, matching the specs' "not in a terminal state" wording, and comment why — verify a consignment in `unknown` blocks the switch
- [x] 4.3 Add `courierProvider` to `store-setting.validation.ts` as a `.optional()` enum (not `.nullable()` — there is no third state) — verify an unsupported value is rejected with the configured provider unchanged
- [x] 4.4 Verify a shop with no consignments, and a shop whose consignments have all settled, can both switch freely

## 5. Per-provider webhooks

- [x] 5.1 Add `POST /courier/webhook/:provider` to `courier.route.ts`, keeping `POST /courier/webhook` as a Steadfast alias with a comment explaining that a URL already registered in Steadfast's portal must keep working (design Decision 5) — verify both paths reach a handler
- [x] 5.2 Change `requireWebhookToken` to look the expected token up by the route's provider, keeping constant-time comparison and the refuse-when-unconfigured posture — verify one provider's token is rejected at another's endpoint
- [x] 5.3 Reject a webhook naming an unregistered provider before any consignment lookup — verify no database query runs for an unknown provider
- [x] 5.4 Match the webhook's consignment on `(courierProvider, consignmentId)` and reject a consignment belonging to a different provider, while still acknowledging an entirely unknown consignment with 200 — verify both cases
- [x] 5.5 Write a verification script covering webhook routing: correct token accepted, cross-provider token rejected, unknown provider rejected, cross-provider consignment rejected, unknown consignment acknowledged — verify it passes and cleans up its `__verify_*` rows

## 6. Configuration status endpoint

- [x] 6.1 Add a staff-only endpoint reporting, per registered provider, its capabilities plus whether credentials and webhook token are present — verify the response contains no credential value, only booleans
- [x] 6.2 Verify the configured-but-unconfigured case is reported before dispatch is attempted, naming what is missing

## 7. Admin: courier settings editor

- [x] 7.1 Create `admin/src/features/ui/courier-settings/` following the `useSettingsDraft` + `useUnsavedChangesGuard` pattern, sending only `{ courierProvider }` so its key set stays disjoint from the other settings editors — verify saving does not clear another editor's fields
- [x] 7.2 Seed the editor from a mirrored `DEFAULT_COURIER_SETTINGS` constant so "not configured" is distinguishable from "configured to the default", per the admin settings-editor convention — verify a fresh shop shows the default rather than an empty control
- [x] 7.3 Show each provider's capabilities and configuration status from the endpoint in task 6.1 — verify an unconfigured provider is visibly marked before selection
- [x] 7.4 Surface the in-flight refusal from task 4.1 as a readable message including the count — verify the operator sees the number, not a generic error
- [x] 7.5 Register the route in **both** `src/routes/nav-config.ts` and `src/routes/app-router.tsx`, with the `RoleGuard` wrapper matching the nav `roles` entry — verify the page is reachable and that sidebar visibility and route guard agree

## 8. Admin: provider-aware surfaces

- [x] 8.1 Add a hook exposing the configured provider and its capabilities to the admin — verify it is fetched once and shared rather than per-component
- [x] 8.2 Replace the hardcoded "Send to Steadfast" in `order-detail-page.tsx` with the configured provider's name, hiding the action entirely when the provider has no `dispatch` capability — verify under `MANUAL` no dispatch action renders and no configuration error appears
- [x] 8.3 Display a shipment as belonging to its *creating* provider where that differs from the configured one — verify with a shipment whose `courierProvider` differs from the setting
- [x] 8.4 Gate the balance card in `courier-page.tsx` and the return action in `order-detail-page.tsx` on their respective capabilities — verify neither renders for a provider lacking them
- [x] 8.5 Update `dispatch-preview.tsx` and `dispatch-result.tsx` to name the configured provider — verify `pnpm --filter ./admin test` passes, updating `dispatch-result.test.tsx` for the new labels
- [x] 8.6 Verify `pnpm --filter ./admin build` succeeds (it type-checks; there is no separate typecheck script)

## 9. Verification and documentation

- [x] 9.1 Write `scripts/verify-courier-provider.ts` asserting: every registered provider's declared capabilities correspond to callable methods; an undeclared action is refused at the service boundary; `MANUAL` declares nothing — verify it passes
- [x] 9.2 Write `scripts/verify-courier-provider-switch.ts` covering the in-flight refusal, the settled-consignments allowance, and the no-consignments allowance, creating `__verify_*` rows and cleaning up in a `finally` — verify it passes
- [x] 9.3 Re-run every existing courier verification script and confirm all pass unchanged — verify `verify-courier-dispatch.ts` and `verify-courier-mapping.ts` still pass
- [x] 9.4 Add the new and changed courier endpoints to `postman/Ecom.postman_collection.json` and run `verify:postman`
- [x] 9.5 Update the header comments of `courier.service.ts`, `courier.guard.ts` and `shipment.service.ts` where this change alters the behaviour they describe, citing `openspec/changes/add-courier-provider-selection` — verify each comment matches the code beneath it
- [x] 9.6 Update the courier section of the root `CLAUDE.md` to describe provider selection, and verify no remaining doc claims the courier module is Steadfast-only
