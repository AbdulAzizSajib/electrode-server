## 1. Schema and migration (server)

- [x] 1.1 Add `PromoBannerLayout` enum (`ONE`, `TWO`, `THREE`) to `prisma/schema/enums.prisma` with a `///` comment stating that position/order is not load-bearing here but `THREE` is the default because it is what the storefront rendered before groups existed; verify `npx prisma validate` passes
- [x] 1.2 Create `prisma/schema/PromoBannerGroup.prisma` — `id`, `name`, `layout PromoBannerLayout @default(THREE)`, `sortOrder Int @default(0)`, timestamps, `banners Banner[]`, `@@index([sortOrder])`; `///` comment must state that deleting a group detaches rather than deletes its banners and why (design.md Decision 2); verify `npx prisma validate` passes
- [x] 1.3 Add `promoBannerGroupId String?` + relation with `onDelete: SetNull` to `prisma/schema/Banner.prisma`, with a `///` comment stating a banner belongs to at most one group and that only `MID`-placement banners may be assigned; verify `npx prisma validate` passes
- [x] 1.4 Generate the migration with `npm run migrate --workspace server`, then **open the generated SQL and delete the three `DROP INDEX` lines** for `Product_name_trgm_idx`, `Product_sku_trgm_idx`, `Brand_name_trgm_idx` and carry forward the NOTE block from the most recent migration; verify by grepping the new migration for `DROP INDEX` and getting no hits
- [x] 1.5 Extend the same migration with the backfill (design.md Decision 7 steps 3–4): create one `Promo banners` group with layout `THREE` **only when at least one `MID` banner exists**, assign every `MID` banner to it, and rewrite each `StoreSetting.homeConfig` array in place so its existing `MID_BANNERS` entry carries that group's `groupId` while keeping its position and `enabled` flag; "no `MID_BANNERS` entry found" must be treated as success, not failure
- [x] 1.6 Apply the migration against the dev database and verify by querying: a store that had three `MID` banners now has one group holding all three, and its `homeConfig` `MID_BANNERS` entry carries that group's id in its original position with its original `enabled` value

## 2. Promo banner group module (server)

- [x] 2.1 Create `src/app/module/promo-banner-group/promo-banner-group.interface.ts` with `ICreatePromoBannerGroupPayload`, `IUpdatePromoBannerGroupPayload`, `IReorderPromoBannerGroupsPayload`, `IPromoBannerGroupResult`; verify it compiles under `npm run build --workspace server`
- [x] 2.2 Create `promo-banner-group.validation.ts` — name required, bounded length, layout restricted to the enum, `sortOrder` an int, reorder payload an array of ids; verify a group with an empty name and one with an over-long name are both rejected
- [x] 2.3 Create `promo-banner-group.service.ts` with create/list/getById/update/reorder/delete. Every mutating call takes `userId` first and records `AuditLogService.record(...)` after the write; delete relies on `SetNull` rather than touching banners; no `req`/`res` anywhere (verify scripts import this directly). Verify by calling each from a scratch script
- [x] 2.4 Create `promo-banner-group.controller.ts` (`catchAsync` + `sendResponse` only) and `promo-banner-group.route.ts` with `checkAuth(...)` → `validateRequest(schema)` → handler ordering; verify every mutating route is admin-gated and the list route is reachable unauthenticated
- [x] 2.5 Register the router in `src/app/routes/index.ts` at the correct position relative to any nested mounts, updating the inline ordering comments; verify `GET /api/v1/promo-banner-groups` responds with the server running
- [x] 2.6 Fire the storefront revalidation for **both** `banners` and `store-settings` after every group mutation, **after the transaction resolves**, not awaited; verify by checking the tags list in `revalidateStorefront.ts` and confirming a group rename fires both

## 3. Banner group assignment (server)

- [x] 3.1 Accept `promoBannerGroupId` (nullable, optional) on banner create and update in `banner.validation.ts`; note in a comment that `.nullable().optional()` is used here deliberately because "no group" is a third meaningful state a merchant must be able to set (per the repo's `.optional()` vs `.nullable()` convention)
- [x] 3.2 In `banner.service.ts`, refuse an assignment whose banner placement is not `MID` with an `AppError`, and refuse a `promoBannerGroupId` naming a group that does not exist; verify both rejections with a scratch script
- [x] 3.3 Include `promoBannerGroupId` on the public `GET /banners` payload; verify the endpoint returns it as a string for a grouped banner and null for an ungrouped one
- [x] 3.4 Fire the `banners` and `store-settings` revalidation after a banner's group assignment changes; verify the fire happens on the assignment path and not only on create/delete

## 4. Homepage configuration becomes instance-aware (server)

- [x] 4.1 Add `PROMO_BANNER_LAYOUTS` to `src/app/module/store-setting/store-setting.constant.ts` with a doc comment stating that position 0 (`THREE`) is the default and why, matching the `HERO_VARIANTS` comment's reasoning; verify it is exported and typed off the Prisma enum
- [x] 4.2 Extend the stored `homeConfig` entry type with an optional `groupId` and update the interface/type comments to state that `MID_BANNERS` may appear more than once while every other key appears at most once
- [x] 4.3 Rewrite `reconcileHomeConfig` per design.md Decision 3: identity is `key` for fixed sections and `key:groupId` for `MID_BANNERS`; drop a promo entry with a missing, non-string, or unknown `groupId`; splice an enabled entry for every existing group named by no entry, at the `MID_BANNERS` registry position in group `sortOrder`. It now takes the group list as a second argument. Verify with the scenarios in `specs/api/support-and-admin/spec.md`
- [x] 4.4 Audit **every** call site of `reconcileHomeConfig` and pass the real group list — do not add a default parameter value (design.md, Risks). Verify by grepping for the identifier across `src/` and `scripts/` and confirming each hit supplies groups
- [x] 4.5 Serve the enabled groups (id, name, layout, sortOrder) in the public settings payload alongside `homeConfig`; verify `GET /settings/public` carries them and that no secret-bearing column was widened in the process
- [x] 4.6 Write `scripts/verify-promo-banner-groups.ts` covering: reconciliation keeps two distinct promo entries; collapses two entries naming the same group; drops an entry whose group was deleted; splices an entry for an unplaced group; still dedupes a repeated `HERO`; an unknown layout resolves to `THREE`; a group delete detaches rather than deletes its banners; and a round-trip through the admin's write shape preserves `groupId`. Uses `__verify_*`-prefixed rows cleaned up in a `finally`. Verify with `npx tsx scripts/verify-promo-banner-groups.ts`

## 5. Storefront rendering (nextjs)

- [x] 5.1 Mirror `PROMO_BANNER_LAYOUTS` and the `groupId` field into `src/types/store-settings.ts`, and `promoBannerGroupId` into `src/types/banner.ts`; add the standing "keep in step with server/" note. Verify `npm run build --workspace nextjs` type-checks
- [x] 5.2 Add the promo groups to `FALLBACK_SETTINGS` in `src/services/store-settings.ts` as an empty list, with a comment stating that a settings outage must degrade to *no promo strip* rather than to a strip with no artwork; verify the merge still repairs a partial payload per-field
- [x] 5.3 Carry `promoBannerGroupId` through the `ApiBanner` → `Banner` mapper in `src/services/banner.ts`; verify a grouped banner keeps its group id through the trim
- [x] 5.4 Rewrite `src/components/home/MidBanners.tsx` to take `groupId`, filter the already-fetched banners to that group, and map the group's layout to a grid class through a **lookup object, never string interpolation** (Tailwind cannot see an interpolated class). Give each layout its own aspect ratio per design.md Decision 5. Update the component's header comment to describe the new behaviour. Verify each of the three layouts renders the right column count in the running app
- [x] 5.5 Update `src/components/home/HomeSkeletons.tsx` so `MidBannersSkeleton` takes the layout and matches the arrangement it stands in for; verify the page does not reflow when a one-tile strip's content lands
- [x] 5.6 Update `src/app/(shop)/page.tsx`: build `MID_BANNERS` per config entry rather than from the `Record<HomeSectionKey, ReactNode>` map, and key the Fragment by `` `${section.key}:${section.groupId ?? ""}` ``. Update the long explanatory comment to state why the section map no longer covers every key. Verify a homepage with two promo strips renders both, with no duplicate-key warning in the console
- [x] 5.7 Update `src/lib/section-layouts.ts` if a promo layout needs resolving storefront-side, and verify `npm run test --workspace nextjs` passes (this suite runs over `src/lib` only, so any pure rule added there needs a test)

## 6. Admin panel (admin/)

- [x] 6.1 Create `src/lib/api/promo-banner-groups.ts` — interfaces, fetch fns, TanStack Query hooks with keys added to `src/lib/query-keys.ts`; verify list/create/update/delete each round-trip against the running server
- [x] 6.2 Mirror `PROMO_BANNER_LAYOUTS`, the `groupId` field on a home-section entry, and the promo-group shape into `src/lib/api/store-settings.ts`, including a `DEFAULT_*` mirror if the editor needs to distinguish "not configured" from "configured to the default"; verify `npm run build --workspace admin` type-checks
- [x] 6.3 **Audit the Home Sections editor's save path for field dropping.** It filters the stored config against `HOME_SECTION_REGISTRY` and writes the filtered list back, so it must preserve `groupId` on every entry it passes through. Verify by saving an unrelated toggle and confirming every promo entry still carries its `groupId` afterwards — this is the highest-consequence regression in the change
- [x] 6.4 Build `src/features/ui/promo-banners/` — list groups, create, rename, pick layout, reorder, delete with a confirm dialog that states the banners will be kept and detached; verify each action updates the list and invalidates the right query keys
- [x] 6.5 Register the page in **both** `src/routes/nav-config.ts` (`NAV_SECTIONS`) and `src/routes/app-router.tsx` (lazy route + `<RoleGuard>`), keeping the role lists in sync by hand; verify the sidebar entry navigates and that a non-permitted role is blocked by the guard, not merely hidden
- [x] 6.6 Add a group picker to the banner form, offered only when the placement is `MID`, with "No group" as an explicit option; verify picking a group assigns it and that the picker is absent for hero and other placements
- [x] 6.7 Show one Home Sections row per group, labelled with the group's name and its tile count, each independently toggleable and orderable; update the `MID_BANNERS` registry entry's description so it no longer claims "the three promotional tiles". Verify the rows match the groups that exist
- [x] 6.8 Warn inline in the group editor when a group's banner count does not match its layout, without blocking the save (design.md Decision 4); verify the warning appears for a `THREE` group holding two banners and that saving still succeeds
- [x] 6.9 State the per-layout recommended artwork dimensions in the group editor, the way `hero-slots.ts` states the hero's; verify the guidance changes when the layout changes

## 7. Verification

- [x] 7.1 Run `npx tsx scripts/verify-promo-banner-groups.ts` and `npx tsx scripts/verify-revalidate-tags.ts` and confirm both pass — the second because this change touches the tags fired from the backend
- [x] 7.2 Run `npm run lint --workspace server`, `npm run test --workspace admin` and `npm run test --workspace nextjs`; confirm all pass (report failures with output rather than working around them)
- [x] 7.3 End-to-end in the running app: create a second group with layout `ONE`, assign one banner, place it below Featured products, and confirm the storefront renders two distinct promo strips in the merchant's order after the cache invalidation lands — no redeploy, no waiting out a window
- [x] 7.4 Confirm the upgrade is invisible for an existing store: on a database migrated from the pre-change state and with no admin action taken, the homepage renders the same three-across strip in the same position as before
