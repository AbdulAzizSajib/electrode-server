## 1. Schema and migration

- [x] 1.1 In `prisma/schema/enums.prisma`, append `HERO_SLIDER`, `HERO_SIDE`, `HERO_PROMO` to the `BannerPlacement` enum after the existing five values; add a short comment mapping each to its storefront region (large left carousel / square top-right tiles / wide tile beneath)
- [x] 1.2 Generate the migration with `--create-only --name add_hero_banner_placements` and inspect the SQL: it must contain only `ALTER TYPE "BannerPlacement" ADD VALUE ...` statements, with no table rewrite, no column change, and no `UPDATE` of existing rows
      <!-- Migration 20260830083902_add_hero_banner_placements: exactly three ADD VALUE
           statements, nothing else. Prisma emitted its standard "more than one value"
           comment, which applies only to Postgres <= 11. -->
- [x] 1.3 Apply the migration and confirm it succeeds — `ALTER TYPE ... ADD VALUE` inside Prisma's transaction wrapper is permitted on Postgres 12+ only because the migration does not *use* the new values; verify rather than assume
      <!-- Verified rather than assumed: queried `SELECT version()` -> PostgreSQL 18.6,
           well past the v11 limitation. Migration applied cleanly. -->
- [x] 1.4 Run `prisma generate` and confirm the regenerated client exports all eight `BannerPlacement` values
- [x] 1.5 Verify the six existing banner rows still read `placement = 'HEADER'` and are otherwise unchanged
      <!-- All 6 rows intact: placement=HEADER, status=ACTIVE, type=IMAGE, images
           present. Note their endsAt is now null (previously 2026-02-01, expired) —
           cleared outside this change, so they are publicly servable again. -->

## 2. Validation

- [x] 2.1 In `banner.validation.ts`, add the three new values to `bannerPlacementEnum` so it mirrors the Prisma enum exactly; add a comment noting the two lists are hand-synced and must be updated together (design.md Risks)
      <!-- design.md Risks named TWO hand-written copies of the placement list (Prisma
           enum + Zod enum). There was a THIRD: `ICreateBannerPayload.placement` in
           banner.interface.ts was a hardcoded string-literal union, and
           `getPublicBanners(placement?: ICreateBannerPayload["placement"])` derives
           its parameter type from it — so widening only the Zod enum broke the
           controller at banner.controller.ts:67 (caught by tsc, not by any test).
           Fixed by deriving `placement` (and `type`) from the generated Prisma enums,
           which removes the drift risk permanently rather than adding a third list to
           keep in sync by hand. -->
- [x] 2.2 Confirm the widened enum flows through all three consumers without further edits: `createBannerZodSchema`, `updateBannerZodSchema`, and `publicBannerQueryZodSchema`
      <!-- All three accept the three new values and still accept all five originals. -->
- [x] 2.3 Verify a create/update with an undefined placement value (e.g. `HERO_MIDDLE`) is rejected with a 400 validation error naming the field, and no banner is written
      <!-- `HERO_MIDDLE`, `hero_side` (wrong case/separator), `""`, and `HERO` all
           rejected with issue path ["placement"]; the query schema rejects them too. -->

## 3. Service and routes — verification only

- [x] 3.1 Confirm `getPublicBanners(placement?)` needs no change: it adds whatever placement it receives to the `where` clause and already orders by `sortOrder` ascending
      <!-- Confirmed at banner.service.ts:90 — `...(placement ? { placement } : {})`
           plus `orderBy: { sortOrder: "asc" }`. Its parameter type derives from
           ICreateBannerPayload["placement"], which is why the 2.1 interface fix was
           required for the new values to reach it. -->
- [x] 3.2 Confirm `getAdminBanners` already exposes `placement` in `filterableFields`, so `?placement=HERO_SIDE` works on the admin listing
- [x] 3.3 Confirm no route change is needed — `GET /banners?placement=` is already wired to the public controller

## 4. End-to-end verification

- [x] 4.1 Create one `ACTIVE` banner per new placement with `endsAt` unset (or in the future), each with a distinct `sortOrder`
- [x] 4.2 Verify `GET /banners?placement=HERO_SLIDER`, `?placement=HERO_SIDE`, and `?placement=HERO_PROMO` each return only their own banners, in `sortOrder` order
- [x] 4.3 Verify a `HERO_PROMO` banner does not appear in a `?placement=HERO_SIDE` listing (the cross-region isolation the whole change exists for)
      <!-- Checked in both directions: PROMO absent from SIDE, SIDE absent from PROMO. -->
- [x] 4.4 Verify `GET /banners` with no placement filter still returns every qualifying banner across all regions
- [x] 4.5 Verify a region with no qualifying banners returns 200 with an empty list, not an error
- [x] 4.6 Verify the status and scheduling rules still apply per region: a `DRAFT` banner and an expired-`endsAt` banner assigned to a hero region are both absent from that region's listing
      <!-- Also covered a future `startsAt`, and confirmed the valid banner in the same
           region is still returned (i.e. the filter excludes only what it should). -->
- [x] 4.7 Verify no per-region cap exists: publish five `HERO_SIDE` banners and confirm all five are returned and none was rejected at creation
      <!-- Ended up with 8 ACTIVE banners in HERO_SIDE (3 from earlier steps + 5 new);
           all 8 returned, none rejected at creation. First run asserted a hardcoded 5
           and reported FAIL on a correct system — the harness now counts the region
           before topping up rather than assuming. -->
- [x] 4.8 Verify `?placement=HEADER` still returns the pre-existing banners unchanged (no regression for existing clients)
      <!-- All 6 pre-existing rows still served under HEADER. -->
- [x] 4.9 Delete every banner created for this verification
      <!-- All 13 deleted; re-checked afterwards that the 6 pre-existing rows survived. -->

## 5. Handoff

- [x] 5.1 Update the public banner request in `postman/Ecom.postman_collection.json` to document the three new placement values, and add one example request per hero region; regenerate `postman_structure.txt`
      <!-- 3 requests added (one per hero region); 3 existing descriptions updated to
           list the full 8-value enum (public unfiltered, public HEADER, admin filter). -->
- [x] 5.2 Run `tsc --noEmit`, `npm run lint`, and `openspec validate --strict` on this change; resolve any findings
      <!-- All pass. tsc surfaced the banner.interface.ts drift fixed under 2.1. The one
           lint warning is a pre-existing unused eslint-disable in app.ts, untouched. -->
- [x] 5.3 Record the downstream work not included here: `Hero.tsx` replacing `heroSlides`/`sideBanners`/`promoTile` with per-region API reads, the admin placement dropdown gaining three options, and the content task of reassigning the six existing `HEADER` banners and fixing their expired `endsAt`

## Downstream work (not part of this change)

**`electrode-nextjs`:**
- `src/components/home/Hero.tsx` — replace the three hardcoded arrays from `src/data/content.ts` with API reads: `heroSlides` → `?placement=HERO_SLIDER`, `sideBanners` → `?placement=HERO_SIDE`, `promoTile` → `?placement=HERO_PROMO`. Follow the never-throw pattern `getCategoryTree()` uses, since these render above the fold.
- Because there is no per-region cap (design.md Decision 3), each region must render **whatever count it receives** — rotate, scroll, or wrap — rather than assuming today's 1/2/1 layout. `promoTile` in particular is currently a single object, not an array.
- `src/components/home/MidBanners.tsx` can move to `?placement=MID`.

**`electrode-admin`:** the placement dropdown gains `HERO_SLIDER`, `HERO_SIDE`, `HERO_PROMO`.

**Content (no code):** the six existing banners are all still `placement = HEADER`, so they will not appear in any hero region until an admin reassigns them. Their `endsAt` is now `null` (it was `2026-02-01`, expired — cleared outside this change), so they are servable again.
