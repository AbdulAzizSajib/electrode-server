## Context

See proposal.md for motivation. This isn't a new pattern for the codebase — it's the existing multipart-with-a-`data`-field convention, extended from single-file to multi-file:

- `validateRequest` (`src/app/middleware/validateRequest.ts`) already does `if (req.body?.data) req.body = JSON.parse(req.body.data)` before zod-parsing — added for exactly this purpose, currently exercised by one route.
- `PATCH /auth/me` (`updateOwnProfile`) is the existing precedent: `multerUpload.single("image")` runs ahead of `validateRequest`, the controller checks `if (req.file)`, uploads via `uploadFileToCloudinary`, and merges the resulting `secure_url` into the payload before calling the service. A plain JSON request without a file works unchanged — multer only intercepts `multipart/form-data`; `express.json()` (mounted globally in `app.ts`) handles everything else, and `req.file` is simply `undefined`.
- `multerUpload` (`src/app/config/multer.config.ts`) uses `multer.memoryStorage()` — no disk writes, buffers go straight to `uploadFileToCloudinary`.
- `product.service.ts`'s `createProduct`/`updateProduct` already accept `images: IProductImageInput[]` (`{ id?, url, altText?, sortOrder?, isPrimary? }`) and already reconcile them (`syncProductImages` for update; plain nested `create` for create). Nothing in the service layer needs to change — only how the controller assembles that array.

## Goals / Non-Goals

**Goals:**
- Reuse the exact `multer.array(...)` → `validateRequest`'s `data`-field unwrap → controller-merges-`req.files` pattern `updateOwnProfile` already established, scaled from one file to many.
- A single request can mix kept-existing images (by `id`), new URL-based images, and newly-uploaded files — the controller produces one normalized `IProductImageInput[]` before calling the unchanged service functions.

**Non-Goals:**
- No change to `POST /upload/image` (stays the general-purpose single-file endpoint used by Category/Banner).
- No per-file resumable/chunked upload, no client-side direct-to-Cloudinary signed upload — same synchronous buffer-through-the-server model every other upload in this codebase uses.
- No new Prisma model or column — uploaded files become ordinary `ProductImage.url` values, indistinguishable from a URL an admin typed in by hand.

## Decisions

**1. `imageSlots` (not extending `productImageZodSchema.url` to be optional) is how an uploaded file gets its metadata.** The `data` field's `images` array stays exactly `productImageZodSchema[]` — every entry still requires a `url` — because zod-validating a "URL or file" union would leak transport detail (multipart vs JSON) into the schema shared by both. Instead, `data` gains one new optional sibling field, `imageSlots: { altText?, sortOrder?, isPrimary? }[]`, whose `i`-th entry describes the `i`-th file in the `images` multipart field (by upload order, matching how multer's `req.files` array preserves field order). The controller uploads each file, builds a `{ url: <cloudinary url>, ...imageSlots[i] }` object, and **appends** those to whatever `images` array was already in `data` — so `data.images` (all URL-based, each optionally carrying an `id` to keep/update an existing row) and the file uploads are two independent, mergeable sources feeding the same `IProductImageInput[]` the service already expects.
- *Alternative considered*: reuse `updateOwnProfile`'s single-field-merge trick (`payload.image = url`) by requiring one file per `images[i]` placeholder with a sentinel `url`. Rejected — fragile ordering coupling between a JSON array and a multipart field with no independent metadata channel, and awkward for "add 3 new files, no matching placeholders needed."
- *Alternative considered*: give each file a client-generated key (e.g. `images[abc123]` field names) instead of positional `imageSlots`. Rejected — more moving parts than this codebase's existing multipart precedent needs; positional matching is sufficient because the client controls both the file order and the `imageSlots` array order in the same request.

**2. Route wiring: `multerUpload.array("images", 10)` runs unconditionally before `validateRequest` on both `POST /products` and `PATCH /products/:id`**, exactly where `updateOwnProfile`'s `.single("image")` sits relative to its `validateRequest`. `10` matches this being a reasonable per-product image cap (existing `getPublicProductBySlug`/admin UIs don't page image lists) and is a starting limit, not a spec-level constraint — adjustable later without a behavior change. A plain JSON request (no `Content-Type: multipart/form-data`) passes through multer as a no-op, same as today.

**3. File upload happens in the controller, before the service call — not inside `product.service.ts`.** Keeps the service layer's existing contract (`ICreateProductPayload`/`IUpdateProductPayload` with a plain `images: IProductImageInput[]`) completely unchanged, so `createProduct`/`updateProduct`, `syncProductImages`, and every existing test/caller of the service keeps working without modification. Cloudinary is an HTTP-boundary concern, matching where `updateOwnProfile` already does its own upload-then-merge.

**4. All uploads for a request complete (or the request fails) before any Prisma write.** The controller `Promise.all`s the Cloudinary uploads for `req.files`, and only calls `ProductService.createProduct`/`updateProduct` once every upload has resolved — so a mid-batch Cloudinary failure throws before touching the database, and `updateProduct`'s existing `$transaction` boundary (which already wraps the DB-side sync) is never left half-applied because of an upload problem. This mirrors `updateOwnProfile`'s single-file version of the same ordering.

**5. Orphaned Cloudinary uploads on a late validation/DB failure are accepted as a known gap, not solved here.** If uploads succeed but the subsequent `ProductService` call throws (e.g. a duplicate SKU caught after upload), the already-uploaded file(s) are not retroactively deleted from Cloudinary. `deleteFileFromCloudinary` exists and is best-effort by design (see its own comments) for the *replace/delete* path, not a two-phase-commit guarantee for *create* — matching the pre-existing risk profile of `updateOwnProfile` (an avatar upload has the identical gap today). Flagged in Risks below rather than solved, to keep this change scoped to "multi-file input," not "upload transactionality."

## Risks / Trade-offs

- **[Risk]** Orphaned Cloudinary files when upload succeeds but product create/update subsequently fails validation (e.g. duplicate SKU, category not found) → **Mitigation**: none in this change (Decision 5); pre-existing gap shared with `updateOwnProfile`, acceptable at this codebase's scale; a future cleanup job could sweep unreferenced `Bariyan/images/*` public IDs if it becomes a real problem.
- **[Risk]** `multer.array("images", 10)` rejects an 11th file with a generic multer error rather than a friendly `AppError` → **Mitigation**: add multer's error to the list `globalErrorHandler` already special-cases (it already handles at least one multer error shape, given `uploadFileToCloudinary`'s errors flow through it) — verify during implementation and add a specific message if missing.
- **[Risk]** A large multi-file upload (10 files × several MB) held in memory (`multer.memoryStorage()`) increases peak memory per request → **Mitigation**: none beyond the existing `multerUpload` config (no size limit is set today either, for the single-file routes) — out of scope to introduce sitewide upload limits in this change; flag as a pre-existing condition, not a new one.

## Migration Plan

1. Add `imageSlots` to `createProductZodSchema`/`updateProductZodSchema` (and `ICreateProductPayload`/`IUpdateProductPayload`) as an optional array, validated but not persisted directly — the controller consumes it, the service never sees it.
2. Add `multerUpload.array("images", 10)` to `product.route.ts`'s `POST /` and `PATCH /:id`, ahead of `validateRequest`.
3. In `product.controller.ts`, before calling `ProductService.createProduct`/`updateProduct`: if `req.files` is non-empty, upload each via `uploadFileToCloudinary`, zip with `req.body.imageSlots` by index, append to `req.body.images`.
4. No schema migration, no change to `product.service.ts`'s exported functions or their signatures.
