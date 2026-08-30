## Context

See proposal.md — Why. Design-relevant current state:

- **The schema change is committed but inert.** `prisma/schema/Banner.prisma` has the new shape as of `51fba5e`, but `prisma/migrations/` has no corresponding migration (latest is `20260827000000_add_order_idempotency_key`) and `src/generated/prisma/client` contains no `BannerType`/`BannerPlacement`. Nothing in `src/` can reference the new fields until `prisma generate` runs, so regeneration gates every other task.
- **`validateRequest` accepts `z.ZodObject` specifically** (`src/app/middleware/validateRequest.ts`: `(zodSchema: z.ZodObject)`), not the broader `ZodType`. A `z.discriminatedUnion` is *not* a `ZodObject`, so type-discriminated validation cannot be expressed as a union without also widening that shared middleware's signature — which would touch every other module's routes.
- **`QueryBuilder`'s `filter()`** copies every non-excluded query param into a Prisma `where` when the key is in `filterableFields`; it does no enum validation of its own. It is used by `getAdminBanners` today and stays the mechanism for the admin listing.
- **The public listing does not use `QueryBuilder`** — `getPublicBanners` builds its `where` by hand because of the `startsAt`/`endsAt` window `AND`/`OR` logic. Adding `placement` to it is a hand-written addition, not a QueryBuilder concern.
- **Prisma returns `Decimal` for money columns** (`Product.price` is `Decimal @db.Decimal(12,2)`; `Banner.price` is `Decimal @db.Decimal(10,2)`). These serialize to strings through `sendResponse`'s JSON path, consistent with how product endpoints already return prices.

## Goals / Non-Goals

**Goals:**
- Land the schema as a migration that is safe against existing rows, and make the whole banner module compile and behave against the new shape in one change.
- Keep a product-linked banner's price structurally incapable of going stale, by resolving at read time rather than storing a copy.
- Keep the public response self-sufficient for rendering — no follow-up product fetch from the storefront.

**Non-Goals:**
- No category targeting. The `category` relation from `51fba5e` is removed rather than wired up (proposal — What Changes).
- No banner impression/click analytics, no A/B slots, no per-placement count caps. Placement is a filter and an ordering scope, nothing more.
- No change to how banner images are uploaded — `POST /upload/image` stays the path, and `image` remains a URL string on the banner.
- No caching layer for the public listing. It stays a direct query; if it becomes hot, that is a separate change.

## Decisions

**1. Two flat `ZodObject` schemas with a `.superRefine` type check — not `z.discriminatedUnion`.**
`validateRequest` is typed `(zodSchema: z.ZodObject)`. A discriminated union would force widening that signature to `z.ZodType`, a change that reaches every route in the codebase for the benefit of one module. Instead `createBannerZodSchema` is a single `ZodObject` with `type` and `placement` required, all type-specific fields optional, and a `.superRefine` that enforces the per-type contract: `IMAGE` requires `image` and rejects `title`/`subtitle`/`description`/`price`/`discountPrice`/`buttonText`/`bgColor`/`textColor`; `DYNAMIC` requires `title`. `.superRefine` returns a `ZodObject`-compatible schema, so the middleware is untouched.
- *Alternative considered*: widen `validateRequest` to `z.ZodType` and use a real discriminated union. Rejected for this change — it is a cross-cutting middleware signature change motivated by one module, and it would make every existing route's validation type looser at the same time. Worth doing on its own merits later, not smuggled in here.
- *Alternative considered*: validate the type contract in the service instead of the schema. Rejected — the spec's rejection scenarios are 400-shaped input validation, and every other module in this codebase enforces request shape at the zod layer.

**2. `updateBannerZodSchema` is the create schema's fields made optional, with the type contract re-checked against the merged result in the service, not the schema.**
A PATCH body alone cannot be validated against the type rule — `{ title: null }` is only invalid if the *stored* banner is `DYNAMIC`, which the schema cannot see. So the zod update schema validates field shapes only (hex colors, URLs, ranges), and `updateBanner` in the service merges the payload over the loaded row and applies the same type-contract check before writing. This is why the spec has an explicit "update that would leave a banner invalid for its type" scenario: it is a service-layer guarantee, not a schema one.
- *Alternative considered*: forbid changing `type` on update and validate the patch against the stored type in zod via a custom middleware that pre-loads the row. Rejected — pushing a database read into the validation middleware breaks the layering every other module follows.

**3. Price resolution is read-time and product-first, computed in a single mapping function.**
Per the decision recorded with the user: when `productId` is set and the product still exists, `resolvedPrice = product.price` and `resolvedDiscountPrice = product.compareAtPrice`; the banner's own `price`/`discountPrice` columns are ignored. Only with no linked product do the banner's stored columns supply those values. One `toPublicBanner(banner)` function in `banner.service.ts` produces the public shape, so the resolution rule exists in exactly one place and both the listing and any future single-banner public read share it.
- *Why product-first over banner-override-first*: the user chose the variant where a product-linked banner can never disagree with the product page. An admin who wants a banner-specific promo price uses a banner with no `productId`. Storing an override that silently wins over live data is precisely the staleness this change exists to remove.
- **Consequence**: `Banner.price`/`discountPrice` are only meaningful for product-less banners. They are kept (not dropped) because a `DYNAMIC` banner advertising a bundle or a category-wide sale has a price to show and no single product to link. This is documented in the schema comment rather than left implicit.

**4. The linked product is fetched via a scoped Prisma `include`, and a missing product degrades rather than fails.**
`getPublicBanners` includes `product: { select: { id, name, slug, price, compareAtPrice, images: { where: { isPrimary: true }, take: 1, select: { url: true } } } }` — the slim summary the user asked for, not the full product. Because `Banner.productId` is `SetNull`-free (it is a plain optional relation), a deleted product could otherwise 500 the whole listing; the mapper treats a null `product` as "no product summary, fall back to the banner's own price and link," which is the spec's "banner links to a product that no longer exists" scenario.
- *Note on the primary image*: `ProductImage` has an `isPrimary` flag; if a product has none flagged, the summary's image is null rather than arbitrarily picking one. The storefront already handles imageless products elsewhere.

**5. `resolvedLink` is a path, not an absolute URL.**
`/products/<slug>` — a relative path the storefront routes on directly. The API does not know the storefront's origin (no configured public base URL exists in this codebase), and hardcoding one would break across environments. A banner's manual `link` is passed through exactly as stored, since an admin may legitimately point at an external campaign page.

**6. The `placement` query param is validated by zod at the route, not by `QueryBuilder`.**
The public route gets a small `z.object({ placement: bannerPlacementEnum.optional() })` query validation so an unknown placement returns 400 (spec scenario) rather than silently matching nothing. `validateRequest` only reads `req.body`, so this needs a query-targeted check — the simplest correct form is validating `req.query` inside the controller before calling the service, which is where `getAdminBanners` already reads `req.query`. For the admin listing, `type` and `placement` are simply added to `QueryBuilder`'s `filterableFields`.

**7. `title` becomes nullable, and the dead commented-out model is deleted.**
`title` was `String` (required); it is now `String?` because an `IMAGE` banner has no title. That is a column alteration on an existing table, safe in the widening direction (`NOT NULL` → `NULL` never fails). The commented legacy model at the top of `Banner.prisma` is removed as part of this change — leaving a stale duplicate of a model definition in the file invites editing the wrong block.

**8b. `image` becomes nullable (decided during implementation).**
`Banner.image` was `String` (NOT NULL) and this change originally left it alone. But the type contract says `image` is required only for `IMAGE`, and a `DYNAMIC` banner renders over `bgColor` — so `{type: "DYNAMIC", title: "..."}` passed zod and then failed at the database, exactly the validation/storage disagreement this change exists to remove. TypeScript surfaced it: Prisma's `BannerUncheckedCreateInput` has `image: string` while the payload type has it optional. Resolved by a second migration (`20260830050240_banner_image_nullable`) making the column nullable, with `image` required for `IMAGE` at the zod layer only. That migration also drops the `placement` column default — intentional, since the `'HEADER'` default from the first migration existed solely to backfill pre-existing rows and the model deliberately carries no `@default`.

**8c. `type` carries its `.default("IMAGE")` on the create schema only (bug found during verification).**
`updateBannerZodSchema` was `z.object(bannerFields).partial()` with `type` defaulted in `bannerFields`. Zod's `.partial()` does **not** strip a default, so every PATCH that omitted `type` parsed to `type: "IMAGE"` and overrode the stored `DYNAMIC` during the service-layer merge — making any update to a DYNAMIC banner fail as an invalid IMAGE banner. The default now lives on `createBannerZodSchema` alone, and `bannerFields.type` is undefaulted so the update schema stays a true patch. Worth noting generally: a defaulted field is unsafe in any `.partial()`-derived update schema in this codebase.

**8d. Banner artwork uploads via `multer.fields()`, merged into the payload BEFORE validation.**
Banner has two distinct single-file fields (`image`, `mobileImage`), so `.fields([{name:"image",maxCount:1},{name:"mobileImage",maxCount:1}])` rather than the `.array()` that `POST /products` uses for its homogeneous image list. The non-file payload rides in a `data` JSON field, which `validateRequest` already unwraps.

The ordering is the one real decision here: the upload middleware runs **before** `validateRequest`, not after. The type contract requires `image` for an `IMAGE` banner, but an uploaded file only becomes a URL once Cloudinary responds — validating first would reject a perfectly valid upload for a "missing" image that is sitting in `req.files`. Running the merge first means it must also unwrap the `data` field itself (it would otherwise still be a JSON string when the merge reads `req.body`), which is why that unwrap is duplicated there. Downstream, the zod schema and the whole service layer see an ordinary URL payload and need no multipart awareness at all.
- *Alternative considered*: keep `validateRequest` first and teach the schema that a file may substitute for `image` (e.g. a sentinel, or checking `req.files` inside the refinement). Rejected — it leaks transport detail into the schema, and zod refinements have no access to `req`.
- *Alternative considered*: upload in the controller after validation, like `updateOwnProfile` does for a single avatar. Rejected — that endpoint has no conditional-required contract on the uploaded field, so ordering does not matter there; here it does.
- An empty file field is rejected with a 400 before reaching Cloudinary, which would otherwise fail deep in the SDK and surface as an opaque 500.

**8. `searchableFields` for the admin listing stays `["title", "subtitle"]`.**
Both are now nullable, which Prisma's `contains` handles (a null column simply does not match). Adding `description` to the searchable set is a judgment call left alone — it changes admin search behavior without being asked for.

## Risks / Trade-offs

- **`placement` is required in the Prisma schema with no `@default`, but the migration adds it with `DEFAULT 'HEADER'`.** → Intentional and safe, but the two must be understood together: the SQL default exists so existing rows backfill, while the *application* still requires `placement` on create because zod demands it. The database default is a migration-time backfill device, not an API affordance. Task 1.3 pins this by keeping the default in the SQL only and not adding `@default(HEADER)` to the Prisma model — if a later `prisma migrate dev` regenerates from the model, verify the drift does not silently drop the column default on a fresh database.
- **Prisma `migrate dev` may want to drop-and-recreate rather than alter** when it sees an added enum plus a `NOT NULL` column on a table with rows. → The migration SQL is written by hand (`--create-only`, then edit) and reviewed before applying, so the exact `ALTER TABLE ... ADD COLUMN ... NOT NULL DEFAULT 'HEADER'` lands rather than whatever Prisma infers. Task 1.3 makes this explicit.
- **This is a breaking change for any existing admin client** posting the old banner body (proposal — BREAKING). → Unavoidable given `placement` is genuinely required for the feature. Mitigated by the fact that stored data is untouched and the break is a clear 400 on create, not a silent behavior change. The admin frontend, if it posts banners today, needs a matching update — out of scope here, flagged for the caller.
- **`Decimal` fields serialize as strings in JSON.** → Consistent with every other price in this API (product listings already do this), so the storefront's existing money handling applies. Called out because `resolvedPrice` is a new field name and a consumer might assume it is a number.
- **Read-time price resolution means one extra join on the public listing.** → Negligible at banner-listing cardinality (a placement holds a handful of banners), and the `@@index([placement, sortOrder])` added in `51fba5e` covers the filter+sort. Not worth caching until measured.

## Migration Plan

1. Edit the Prisma schema (remove the commented model, remove the `category`/`categoryId` relation and `Category.banners`), then generate the migration with `prisma migrate dev --create-only` so the SQL can be inspected and corrected before it runs.
2. Hand-verify the SQL: enum creation for `BannerType`/`BannerPlacement`, `placement` added `NOT NULL DEFAULT 'HEADER'`, `title` altered to nullable, no `categoryId` column, index changes applied. Confirm no destructive `DROP TABLE`/`DROP COLUMN` on `Banner` beyond the intended `@@index([sortOrder])` removal.
3. Apply, then `prisma generate` — the module cannot typecheck before this.
4. Update the module (validation → interface → service → controller), then `npx tsc --noEmit` and `npm run lint`.
5. Verify against a running instance per tasks.md section 6.

**Rollback**: the migration is additive plus one widening column alteration. Rolling back the code alone leaves the new columns unused and harmless — the old module shape still works against the migrated table, since every new column is either nullable or defaulted. A schema rollback is therefore not required to revert the API.

## Open Questions

- Whether the admin frontend currently creates banners, and so needs a matching update for the now-required `placement`. This does not change the backend's specs, approach, or tasks — it is a downstream coordination item to raise once this lands.
