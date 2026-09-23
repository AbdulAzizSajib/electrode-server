## 1. Data model

- [ ] 1.1 Add the `Courier` model in `prisma/schema/courier.prisma` — name (unique), optional phone, email, coverage note and tracking-URL template, `isActive` defaulting true, timestamps — with `///` doc comments; verify `npx prisma validate` passes
- [ ] 1.2 Add `courierId String?` + relation to `Shipment`, and a `///` comment on both it and `carrier` recording that `carrier` is historical/read-only and `courierId` is authoritative (design Decision 2); verify `npx prisma validate` passes
- [ ] 1.3 Run `pnpm --filter ./server migrate`, then **open the generated SQL, delete the three `DROP INDEX` lines for `Product_name_trgm_idx` / `Product_sku_trgm_idx` / `Brand_name_trgm_idx`, and copy the NOTE block forward from the previous migration**; verify by grepping the new migration for `DROP INDEX` and getting no hits
- [ ] 1.4 Confirm the trigram indexes survived: query `pg_indexes` for the three index names and verify all three are still present

## 2. Courier module (server)

- [ ] 2.1 Create `src/app/module/courier/courier.interface.ts` with `ICreateCourierPayload` / `IUpdateCourierPayload` / `ICourierResult`; verify `tsc` compiles
- [ ] 2.2 Create `courier.validation.ts` with Zod schemas, using `.optional()` alone for partial updates per the repo convention; verify a partial update payload parses and an unknown key is stripped
- [ ] 2.3 Create `courier.service.ts` — list (active-only filter), get, create, update, deactivate — taking `userId` first and calling `AuditLogService.record` after each write, touching no `req`/`res`; verify the service imports cleanly in a scratch tsx script
- [ ] 2.4 Add unique-name enforcement returning a 409 `AppError`; verify creating a duplicate name throws 409 (spec: *Duplicate courier name is refused*)
- [ ] 2.5 Implement delete-guard: refuse with 409 and the referencing shipment count when shipments reference the courier, delete otherwise; verify both branches (spec: *Deleting a courier in use*)
- [ ] 2.6 Create `courier.controller.ts` (catchAsync + sendResponse only) and `courier.route.ts` with `checkAuth(OWNER, ADMIN)`; verify a customer-role request gets 401/403 (spec: *Courier management is staff-only*)
- [ ] 2.7 Mount `/couriers` in `src/app/routes/index.ts` respecting the file's ordering comments; verify `GET /api/v1/couriers` responds
- [ ] 2.8 Write `scripts/verify-courier.ts` creating `__verify_`-prefixed rows and cleaning up in a `finally`; verify `npx tsx scripts/verify-courier.ts` exits 0

## 3. Tracking link

- [ ] 3.1 Add tracking-URL template resolution (template + tracking number → link, absent template → no link); verify both cases (spec: *Tracking link is produced from the template*, *Missing template yields no link*)

## 4. Bulk assign (server)

- [ ] 4.1 Add `ICourierAssignPayload` (order ids + courier id) and its Zod schema with an explicit maximum selection size per design Risks; verify an over-cap payload is rejected
- [ ] 4.2 Implement the pre-flight validator: every order exists, is not cancelled, is not `deliveryMethod === 'PICKUP'`, can reach the dispatched status via `assertOrderTransitionAllowed`, and the courier is active — throwing `AppError` naming the offending orders; verify each refusal branch (spec: *An ineligible order blocks the batch*, *Cancelled orders are refused*, *Collection order in a selection is refused*, *Inactive courier cannot receive an assignment*)
- [ ] 4.3 Implement the assign write inside one `prisma.$transaction`: upsert each order's shipment with the courier, advance each order's status through the existing transition path, record status history; verify counts returned match the selection (spec: *Orders without shipments are assigned*, *Existing shipment is reassigned*, *Packed orders ship on assignment*)
- [ ] 4.4 Record one `AuditLogService` entry naming the courier and affected orders; verify the entry appears (spec: *Bulk assignment is audited*)
- [ ] 4.5 Add the route under `checkAuth` staff roles; verify a customer-role request is refused (spec: *Customer cannot assign orders*)
- [ ] 4.6 Write `scripts/verify-courier-assign.ts` covering the happy path and each refusal, asserting **no order changed** on refusal; verify it exits 0 (spec: *A failure leaves the whole selection untouched*)

## 5. Admin — courier resource

- [ ] 5.1 Add `src/lib/api/couriers.ts` (interfaces → fns → TanStack hooks) and its keys in `query-keys.ts`; verify the list hook renders data
- [ ] 5.2 Build the couriers list via `ResourceListPage`, wiring the 409 delete response to the existing reassign/force-confirm escalation; verify deleting an in-use courier surfaces the dialog rather than failing silently
- [ ] 5.3 Build the courier form with `ResourceFormPage` (antd, per the repo's new-form rule); verify create and edit both save
- [ ] 5.4 Register the routes in **both** `nav-config.ts` and `app-router.tsx` with matching role gating; verify the sidebar entry appears and the route loads

## 6. Admin — shipment dialog

- [ ] 6.1 Replace the free-text carrier input with a courier select listing active couriers; verify the dialog saves `courierId`
- [ ] 6.2 Render existing shipments as `courier?.name ?? carrier ?? '—'`; verify a pre-change shipment still shows its original free-text carrier (design Decision 2)
- [ ] 6.3 Show the tracking number as a link when the courier has a template, plain text otherwise; verify both

## 7. Admin — bulk assign

- [ ] 7.1 Add row selection + a bulk action bar to the orders list locally (not to shared `DataTable`, per design Decision 7); verify selecting rows reveals the bar and clearing deselects
- [ ] 7.2 Wire the assign action to the bulk endpoint with a courier picker; verify a successful assign refetches the list and reports the count
- [ ] 7.3 Surface the refusal error listing the blocking orders so the fix is one deselection; verify the message names the offending order numbers

## 8. Documents

- [ ] 8.1 Add `courier-manifest.tsx` beside the existing documents — store + courier identity, date, per-parcel order number/recipient/destination/COD amount, parcel count, collection total, signature and handover-time area, no cost basis; verify against the spec's scenarios
- [ ] 8.2 Default the manifest to A4 and route it through `print-frame.tsx` so chrome is excluded; verify the printed output contains only the document
- [ ] 8.3 Implement batch label print rendering N `ShippingLabel` components into one frame with a page break between; verify five selected orders produce five labels each on its own page (spec: *One page per label*, *Batch label matches the single label*)
- [ ] 8.4 Honour the shared paper-size choice for the batch; verify a thermal selection lays every label out for thermal (spec: *Paper size applies to the batch*)
- [ ] 8.5 Collect orders that cannot produce a label, print the rest, and report the omissions; verify the omitted order is named (spec: *An unprintable order is reported*)
- [ ] 8.6 Extend `documents.test.tsx` to cover the manifest and the batch; verify `pnpm --filter ./admin test` passes

## 9. Verification

- [ ] 9.1 Run `pnpm --filter ./server lint` and `pnpm --filter ./server build`, confirming `fix-imports.js` ran; verify the built server boots
- [ ] 9.2 Run `pnpm --filter ./admin build` and `pnpm --filter ./admin test`; verify both pass
- [ ] 9.3 End-to-end on a dev database: create a courier, select several packed orders, assign, print the manifest and the batch labels, and confirm each order's status, shipment courier and audit entry are correct
- [ ] 9.4 Re-confirm the three trigram indexes still exist after all migrations; verify via `pg_indexes`
- [ ] 9.5 Run `openspec validate add-courier-fulfillment --strict`; verify it reports no errors
