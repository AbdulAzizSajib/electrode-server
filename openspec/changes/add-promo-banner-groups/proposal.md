## Why

The homepage's promotional strip is one fixed section rendering exactly three tiles across. A merchant who wants a single full-width promo, or a pair of half-width ones, or a second promo strip further down the page, has none of those — `MID_BANNERS` is one key in `HOME_SECTION_KEYS`, `MID` is one value in `BannerPlacement`, and `MidBanners.tsx` hardcodes `sm:grid-cols-3`. The merchant's request is the three arrangements they already have artwork for (1, 2 or 3 tiles), and more than one strip per page.

The constraint that makes this a real change rather than a layout tuple: every other homepage section is a *fixed registry key*, and a merchant-created strip is not. The homepage configuration has to learn to carry entries that name a row of data rather than a compiled-in component.

## What Changes

- **New `PromoBannerGroup` model.** A merchant-created, named, ordered group with a `layout` of `ONE | TWO | THREE` and its own set of banners. A store may have any number of them.
- **Banners gain a group.** `Banner` gets a nullable `promoBannerGroupId`. A banner belongs to at most one group; `placement: MID` stays the marker for "this is a promo tile".
- **Homepage sections become addressable by instance.** A `homeConfig` entry may now be `{ key: "MID_BANNERS", groupId: "<uuid>", enabled, ... }` — the same registry key appearing more than once, each occurrence naming a different group. Registry reconciliation, which today dedupes by key and drops anything unregistered, has to keep multiple `MID_BANNERS` entries and drop the ones whose group no longer exists. **BREAKING** for any client that assumed `homeConfig` keys are unique.
- **Admin gets a Promo Banners manager**: create/rename/reorder/delete groups, pick a layout per group, and assign banners to a group. Home Sections lists one row per group, labelled with the group's name, each independently toggleable and orderable.
- **Storefront renders per group.** `MidBanners` takes a group id, reads that group's banners and renders `grid-cols-1 | 2 | 3` from the group's layout. A group whose banner count disagrees with its layout renders what it has rather than erroring.
- **Migration adopts the existing strip.** Existing `MID` banners are moved into one auto-created group named "Promo banners" with layout `THREE`, and the existing `MID_BANNERS` entry in every stored `homeConfig` is rewritten to name it. A merchant's homepage looks identical after deploy with no action taken.
- New cache tag wiring: promo-group writes fire the existing `banners` tag plus `store-settings`, because a group's existence and order are part of the homepage configuration.

## Capabilities

### New Capabilities
- `api/promo-banner-groups`: merchant-created promotional banner groups — their creation, naming, ordering, per-group tile layout, banner membership, deletion behaviour, and how the public payload serves them.

### Modified Capabilities
- `api/marketing`: the public banner listing gains group membership in its payload and the rule that a promo-placement banner is served in the context of its group.
- `api/support-and-admin`: the homepage section configuration requirement changes — a section entry is no longer uniquely identified by its key, and reconciliation must preserve repeated `MID_BANNERS` entries while dropping ones naming a deleted group.

## Impact

**server/**
- `prisma/schema/PromoBannerGroup.prisma` (new), `prisma/schema/Banner.prisma`, `prisma/schema/enums.prisma` (new `PromoBannerLayout`)
- One migration: create table, add column, backfill the default group, rewrite stored `homeConfig` rows. **Remember to strip the three `DROP INDEX` lines Prisma emits for the trigram indexes and carry forward the NOTE block.**
- New module `src/app/module/promo-banner-group/` (route, controller, service, validation, interface, constant), mounted in `src/app/routes/index.ts`
- `src/app/module/banner/` — group assignment on create/update, group filter on the public read
- `src/app/module/store-setting/store-setting.constant.ts` (`PROMO_BANNER_LAYOUTS`) and `store-setting.service.ts` (`reconcileHomeConfig` becomes group-aware, and now needs the group list to reconcile against)
- `scripts/verify-promo-banner-groups.ts` (new)

**nextjs/**
- `src/components/home/MidBanners.tsx`, `src/components/home/HomeSkeletons.tsx`, `src/app/(shop)/page.tsx` (section lookup keyed by instance, not by key)
- `src/types/store-settings.ts`, `src/types/banner.ts`, `src/services/banner.ts`, `src/lib/section-layouts.ts`

**admin/**
- New `src/features/ui/promo-banners/` manager page, registered in `src/routes/nav-config.ts` **and** `src/routes/app-router.tsx`
- `src/lib/api/promo-banner-groups.ts` (new), `src/lib/api/banners.ts`, `src/lib/api/store-settings.ts` (`HOME_SECTION_REGISTRY` mirror), `src/lib/query-keys.ts`, `src/features/ui/home-sections/`

**Not changing:** the hero placements and their layout tuple, `BannerType`'s IMAGE/DYNAMIC contract, and the `MID` placement value itself.
