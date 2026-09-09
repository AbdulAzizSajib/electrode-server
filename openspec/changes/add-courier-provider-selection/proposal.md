## Why

The courier module is named for Steadfast and shaped by its API — `steadfast.client.ts` is called directly from `courier.service.ts`, the carrier string is hardcoded, and the admin panel's only courier surface says "Send to Steadfast". `add-steadfast-courier-integration` recorded a carrier abstraction as an explicit Non-Goal, on the grounds that "a second courier is a second module and a decision made then, not a set of interfaces guessed at now."

That decision point has arrived. Not every merchant deploying this platform uses Steadfast — some use Pathao, some RedX, some a local courier with no API at all — and today switching means editing server code. A merchant should choose their courier from the admin panel, and dispatch should route to whichever they chose.

## What Changes

- **A `courier.provider.ts` interface** that `steadfast.client.ts` is adapted to satisfy. It is derived from the working Steadfast client rather than invented ahead of a second implementation, so it describes what a courier integration actually needs: a dispatch call returning per-consignment outcomes, a status lookup, an optional balance read, an optional return request, and a declaration of which of those it supports.

- **A provider registry** mapping a `CourierProvider` enum value to its adapter. Steadfast is the only registered adapter in this change. A `MANUAL` provider is also registered — it creates no consignments and is what a merchant using an off-platform courier selects, so "no courier integration" becomes a configured state rather than an unconfigured one.

- **`StoreSetting.courierProvider`** — the merchant's selection, defaulting to `STEADFAST` so existing installs are unchanged. Credentials stay in the environment, unchanged; only the *choice* is a setting.

- **`Shipment.courierProvider`** — which provider created each consignment, recorded at dispatch. Without it, changing the setting would orphan in-flight parcels: reconciliation would poll the wrong courier's API with the wrong credentials for a consignment id it has never issued.

- **Per-provider webhook routes** — `POST /courier/webhook/:provider` replaces the single `/courier/webhook`, since each courier posts a different payload shape and presents a different token. The existing path is kept as an alias for Steadfast so a webhook already registered in their portal keeps working.

- **Admin: a Courier Settings editor** under the existing settings-editor pattern, where the merchant picks their provider and sees which capabilities it supports and whether its credentials are configured. **The provider cannot be changed while consignments are in flight** — the setting refuses, naming the count, rather than silently stranding them.

- **Admin: provider-aware labels** — "Send to Steadfast" becomes the configured provider's name, and courier actions the provider does not support (balance, return requests) are hidden rather than shown and failing.

- **BREAKING (internal only):** `CourierService` no longer imports `SteadfastClient` directly. No HTTP contract changes; the dispatch, preview, balance and return endpoints keep their paths, request shapes and response shapes.

**Explicitly not in this change:** a Pathao or RedX adapter. Pathao's API needs OAuth token refresh and `city_id`/`zone_id`/`area_id` resolution rather than an address string — a location-mapping problem of its own size. This change makes adding one a new file plus a registry entry; it does not add one. `MANUAL` covers the merchant who needs a non-Steadfast courier today.

## Capabilities

### New Capabilities
- `api/courier-provider`: Selecting which courier service the shop dispatches through, declaring what each provider supports, and routing dispatch, status and webhooks to the selected one.

### Modified Capabilities
- `api/courier`: Requirements currently written as statements about Steadfast become statements about the *configured provider*. Dispatch records which provider handled it; reconciliation and webhooks route per-consignment rather than assuming one courier; the credential requirement becomes per-provider.

## Impact

**Server**
- New: `courier.provider.ts` (interface + registry), `providers/steadfast.provider.ts` (adapts the existing client), `providers/manual.provider.ts`
- Modified: `courier.service.ts` (resolve provider instead of importing the client), `courier.route.ts` (per-provider webhook path), `courier.guard.ts` (token lookup by provider), `courier.controller.ts`, `store-setting.validation.ts` + `.service.ts`
- Schema: `StoreSetting.courierProvider`, `Shipment.courierProvider`, new `CourierProvider` enum — one additive migration, all defaulted so existing rows are unaffected
- `steadfast.client.ts` keeps its current behaviour; it gains an adapter, not a rewrite

**Admin**
- New: `src/features/ui/courier-settings/`, following the `useSettingsDraft` + `useUnsavedChangesGuard` pattern and sending a disjoint key set to `PATCH /settings`
- Modified: `orders-list-page.tsx`, `order-detail-page.tsx`, `courier-page.tsx`, `dispatch-preview.tsx`, `dispatch-result.tsx` — provider name and capability gating; `nav-config.ts` + `app-router.tsx` for the new settings route

**Storefront**
- None. `GET /settings` gains one enum field the storefront does not read.

**Environment**
- Unchanged. `STEADFAST_*` and `COURIER_SYNC_SECRET` keep their current names and meanings.
