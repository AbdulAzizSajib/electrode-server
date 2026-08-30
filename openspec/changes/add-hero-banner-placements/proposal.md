## Why

The homepage hero is a four-slot composition with three visually distinct shapes: a tall carousel on the left (~550px), two square tiles at the top right (275×265), and one wide tile below them (570 wide). The storefront currently hardcodes these as three separate arrays — `heroSlides`, `sideBanners`, `promoTile` in `src/data/content.ts`.

`make-banner-fully-dynamic` made banner *content* dynamic, but every hero banner necessarily lands on `placement: HEADER`, which is a single bucket. So the API cannot express "this image belongs in the wide bottom tile, not the square one" — an admin uploading a 570-wide promo image has no way to keep it out of the 275-wide square slot, where it would be cropped. Today all six seeded banners are `HEADER`, and the frontend has no signal to split them.

## What Changes

- Add three values to the `BannerPlacement` enum: `HERO_SLIDER`, `HERO_SIDE`, `HERO_PROMO`, alongside the existing `HEADER`, `MID`, `FOOTER`, `SIDEBAR`, `POPUP`.
  - `HERO_SLIDER` — the large left carousel; multiple banners rotate as slides.
  - `HERO_SIDE` — the square tiles at the top right.
  - `HERO_PROMO` — the wide tile beneath them.
- Accept and validate the new values on banner create/update (`bannerPlacementEnum` in `banner.validation.ts`) and on the public listing's `?placement=` query param.
- Keep the public listing's existing contract otherwise unchanged: `ACTIVE` status, `startsAt`/`endsAt` window, ordered by `sortOrder` ascending.
- **No per-slot cap.** The API returns every qualifying banner for a slot; how many are displayed is the storefront's decision. An admin who creates five `HERO_SIDE` banners gets five back, and the frontend renders them as its layout allows (carousel, scroll, or wrap). This is deliberate — see design.md Decision 3.
- `HEADER` is retained and left untouched, so existing banners and any client still requesting `?placement=HEADER` keep working. Migrating the six existing `HEADER` rows to specific hero slots is an admin content decision, not a code migration.

**Not breaking:** the change is purely additive. No enum value is removed or renamed, no response field changes shape, and every existing request remains valid.

## Capabilities

### New Capabilities

*(none — this extends an existing capability)*

### Modified Capabilities

- `api/marketing`: The public banner listing requirement gains addressable hero placements — a banner declares which hero slot it belongs to, and the public listing can be filtered to exactly one slot so the storefront can populate each differently-shaped region independently.

## Impact

**Database (1 migration):**
- `BannerPlacement` enum gains `HERO_SLIDER`, `HERO_SIDE`, `HERO_PROMO`. Postgres `ALTER TYPE ... ADD VALUE` is additive and does not rewrite the `Banner` table. No column changes, no data backfill — existing rows keep `placement = 'HEADER'`.

**Modules touched:**
- `prisma/schema/enums.prisma` — the enum.
- `src/app/module/banner/banner.validation.ts` — `bannerPlacementEnum` (used by create, update, and `publicBannerQueryZodSchema`).
- No service, controller, or route changes: `getPublicBanners(placement?)` already filters on whatever placement it is handed, and `getAdminBanners` already has `placement` in `filterableFields`.

**Consumers (downstream, not in this change):**
- `electrode-nextjs`: `Hero.tsx` replaces `heroSlides` / `sideBanners` / `promoTile` from `content.ts` with three API reads (or one grouped read); `MidBanners.tsx` can move to `placement=MID`.
- `electrode-admin`: the placement dropdown gains three options.
- Postman collection gains hero-slot examples on the public banner request.

**Operational note:** the six existing banners are all `ACTIVE` with `endsAt = 2026-02-01`, already in the past, so they return empty from the public endpoint regardless of this change. Fixing that is content administration, not part of this work.
