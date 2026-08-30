## Context

See `proposal.md` — Why. Only the existing-code facts that constrain the approach are recorded here.

- `BannerPlacement` is a **Prisma enum** in `prisma/schema/enums.prisma:214`, currently `HEADER | MID | FOOTER | SIDEBAR | POPUP`. It is a real Postgres enum type, not a string column.
- `getPublicBanners(placement?)` (`banner.service.ts:90`) already takes an optional placement and adds it to the `where` when present. It already orders by `sortOrder: "asc"` and already applies the `ACTIVE` + `startsAt`/`endsAt` window. **No service change is required** — it filters on whatever placement value it is handed.
- `getAdminBanners` already lists `placement` in `filterableFields`.
- `banner.validation.ts` defines `bannerPlacementEnum` as a hand-written `z.enum([...])` mirroring the Prisma enum, reused by `createBannerZodSchema`, `updateBannerZodSchema`, and `publicBannerQueryZodSchema`. This duplication is the only place the two lists can drift.
- The storefront's hero (`electrode-nextjs/src/components/home/Hero.tsx`) reads three separate hardcoded arrays — `heroSlides` (carousel, `h-[550px]`), `sideBanners` (`lg:h-[265px] lg:w-[275px]`, `grid-cols-2`), and `promoTile` (in the `lg:w-[570px]` right column). The three shapes are what make one bucket insufficient.

## Goals / Non-Goals

**Goals:**

- Let a banner say *which* hero region it belongs to, using the mechanism already in place.
- Keep the change additive: no existing banner, request, or response shape breaks.
- Add zero new columns and zero new service logic.

**Non-Goals:**

- **No per-region count cap** — explicitly decided against (Decision 3).
- **No image dimension validation.** The API does not check that a `HERO_SIDE` upload is actually square; placement declares *intent*, and the storefront's CSS handles fit. Enforcing pixel dimensions would need image introspection in the upload path, which is a separate concern.
- **No automatic migration of the six existing `HEADER` rows** to hero slots. Which banner belongs in which slot is a content decision only the admin can make.
- **No `aspectRatio`/`width`/`height` fields.** Considered and rejected (Decision 2).
- **No frontend work.** `Hero.tsx` and the admin placement dropdown are downstream.

## Decisions

### Decision 1: Extend the `BannerPlacement` enum rather than adding a parallel field

Add `HERO_SLIDER`, `HERO_SIDE`, `HERO_PROMO` to the existing enum.

*Why:* placement already means "which region of the storefront does this render in" — hero slots are more of exactly that, not a new axis. The entire query path (`?placement=`, `getPublicBanners`, `getAdminBanners`'s `filterableFields`, the admin dropdown) works on the new values the day the enum grows, with no new plumbing.

*Alternative rejected — a free-text `slot String?` column:* more flexible, but a typo (`"hero_side"` vs `"hero-side"`) produces a banner that is silently invisible with no error anywhere. A DB enum makes a wrong value a rejected write. Flexibility is not worth a failure mode whose symptom is "the banner just doesn't show up."

*Alternative rejected — reusing `HEADER` plus `sortOrder` ranges* (e.g. 0–9 = slider, 10–19 = side): encodes meaning in a magic number, breaks the moment someone reorders, and is undiscoverable from the schema.

### Decision 2: Rejected — an `aspectRatio` or width/height field

Storing the shape and letting the frontend match banners to slots by dimension.

Rejected because shape does not uniquely identify a slot: `HERO_SIDE` (275×265, ≈1:1) and a future square tile elsewhere on the page would be indistinguishable, and the frontend would need a dimension→slot lookup table that is just the enum, written less safely. Placement answers "where", which is the actual question; dimensions are a consequence of where, not a substitute for it.

### Decision 3: No per-region maximum — the storefront decides how many to show

The API returns every qualifying banner for a region. An admin publishing five `HERO_SIDE` banners gets five.

*Why:* the number of visible tiles is a layout concern that changes with the design and the viewport, and it differs per region (the slider shows one at a time and rotates; the side grid shows two side by side). Encoding "2" in the API would bake today's desktop layout into the database contract, and would mean a redesign requires a migration.

The rejected alternative — 409 on exceeding a per-region cap — also has a bad admin workflow: replacing a banner would require deactivating the old one first, rather than publishing the new one and reordering.

*Consequence, accepted:* an admin can publish a sixth `HERO_SIDE` banner that today's two-up grid will not display. The frontend is expected to render what it receives (rotate, scroll, or wrap) rather than truncate silently. This is the storefront's responsibility and is called out for the downstream work.

### Decision 4: Keep `HEADER`, and do not repurpose it

`HEADER` stays in the enum with its current meaning, and the six existing rows keep it.

*Why:* removing or renaming an enum value used by live rows would be a breaking change requiring a data migration, for no gain — the hero slots are new regions, not a rename of the old one. Any client still requesting `?placement=HEADER` keeps working unchanged.

### Decision 5: Enum ordering in the schema

The three new values are appended after the existing five rather than interleaved.

*Why:* Postgres `ALTER TYPE ... ADD VALUE` appends by default; adding `BEFORE`/`AFTER` clauses to place them mid-list would complicate the migration for a purely cosmetic gain. Enum member order carries no meaning here — banners are ordered by `sortOrder`, never by placement.

## Risks / Trade-offs

- **`bannerPlacementEnum` in `banner.validation.ts` duplicates the Prisma enum** → the two can drift, and a value present in one but not the other yields either a rejected-but-valid write or a write that fails at the DB layer with a raw error. Mitigated by updating both in the same task; a longer-term fix would derive the Zod enum from the generated Prisma enum, which is out of scope here.
- **Postgres enum values cannot be dropped** (no `ALTER TYPE ... DROP VALUE`) → rolling this back requires recreating the type. Since the change is purely additive and unused values are harmless, the practical rollback is to revert the application code and leave the enum values in place.
- **`ALTER TYPE ... ADD VALUE` historically could not run inside a transaction block** in older Postgres; Prisma wraps migrations in one. Postgres 12+ permits it as long as the new value is not *used* in the same transaction — the migration only adds values and touches no rows, so it is safe. Verify the migration applies cleanly rather than assuming.
- **An admin can assign a banner to a slot its artwork does not fit** (a 570-wide image to `HERO_SIDE`) → the API does not validate dimensions (Non-Goals); the result is a cropped or letterboxed image, visible immediately in preview. Accepted as a content-authoring concern.
- **Nothing forces the storefront to actually honor the new slots** → until `Hero.tsx` is rewired, the new values are inert. That is expected: this change makes the API able to express the distinction, and the frontend work follows.

## Migration Plan

One additive migration:

1. **`add_hero_banner_placements`** — `ALTER TYPE "BannerPlacement" ADD VALUE 'HERO_SLIDER'`, `... 'HERO_SIDE'`, `... 'HERO_PROMO'`. No table is rewritten, no row is touched, no column is added. Existing rows keep `placement = 'HEADER'` and remain valid.

**Deploy ordering:** the migration is safe to apply before the application code — the new values simply go unused. Applying the code first would break any request using a new value, so migration first.

**Rollback:** revert the application code; leave the enum values in place (Postgres cannot drop them, and unused values are inert). Only if the type must genuinely be cleaned up does it need recreating, which is not warranted for an additive change.

**Content follow-up (not code):** reassign the existing six `HEADER` banners to the appropriate hero slots and fix their expired `endsAt` (all six currently end `2026-02-01`, in the past, so they return empty from the public endpoint regardless of placement).
