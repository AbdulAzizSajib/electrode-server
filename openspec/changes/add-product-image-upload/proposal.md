## Why

`POST /products` and `PATCH /products/:id` only accept `images` as an array of already-hosted URLs (`productImageZodSchema`) — an admin has to upload each file to `POST /upload/image` first, one request per file, then assemble the URL array client-side before creating/updating the product. There is no way to attach local image files directly to a product create/update call, and no way to upload more than one file in a single request anywhere in the API.

## What Changes

- `POST /products` and `PATCH /products/:id` accept `multipart/form-data` (in addition to the current `application/json`), with:
  - Non-file product fields (`name`, `price`, `variants`, `images`, `attributes`, etc.) sent as a single `data` form field containing the same JSON payload the endpoints already accept — not one form field per scalar, so the existing `createProductZodSchema`/`updateProductZodSchema` validate the parsed JSON unchanged.
  - Zero or more files under a repeated `images` form field (multer `.array("images", 10)`), each uploaded to Cloudinary server-side and appended to the product's `ProductImage` rows.
  - A file-to-slot association: each uploaded file's position in the `images` field order maps to the `i`-th entry of an optional `imageSlots` array in the `data` JSON (`{ altText?, sortOrder?, isPrimary? }`), so an admin can set alt text/primary flag/order for an uploaded file the same way they already can for a URL-based `IProductImageInput` — uploaded files never carry a `url` themselves (the server fills it in after the Cloudinary upload).
  - Existing URL-based `images` entries (with a `url`, optionally an `id` to update/keep an existing `ProductImage` row) keep working exactly as today, so a request can mix "keep this existing image," "add this new URL," and "upload this new file" in one call.
  - **BREAKING**: none of the above changes the JSON-only request shape or response shape — a caller that never sends files continues to work identically. The only new surface is multipart support being *additionally* accepted.
- Plain `application/json` requests to both endpoints are unaffected — this is additive, not a replacement for the URL-array path (some admin workflows, e.g. reusing an image already uploaded elsewhere, still make sense as a URL).
- Upload failures partway through a multi-file batch (one file fails Cloudinary upload) fail the whole request before any database write, consistent with `createProduct`/`updateProduct` already being all-or-nothing (`updateProduct` is already a `$transaction`; `createProduct` gains the same all-or-nothing guarantee with respect to its own file uploads by uploading before the `prisma.product.create` call, not interleaved with it).

## Capabilities

### Modified Capabilities
- `api/catalog`: "Admins can manage the full catalog" gains multipart/form-data file upload as an additional way to populate a product's `ProductImage` rows on create/update, alongside the existing URL-array input.

## Impact

- **Affected code**: `src/app/module/product/product.route.ts` (add `multerUpload.array("images", 10)` ahead of validation on both routes, conditionally — see design.md for how JSON-only requests skip multer's parsing), `product.controller.ts` (parse the `data` field when present, merge uploaded-file URLs into the `images` payload before calling the service), `product.service.ts` (no change to `createProduct`/`updateProduct`'s core logic — they keep receiving a normal `ICreateProductPayload`/`IUpdateProductPayload` with `images: IProductImageInput[]`, now just assembled from a mix of URL and freshly-uploaded entries by the controller).
- **New shared helper**: a small `parseMultipartProductPayload`-style function (exact location TBD in design.md) that uploads `req.files` to Cloudinary via the existing `uploadFileToCloudinary`, merges them with `imageSlots`, and produces the same `IProductImageInput[]` shape `product.service.ts` already consumes — reuses `cloudinary.config.ts`, no new upload plumbing.
- **No schema change**: `ProductImage` already stores a `url` column; nothing new is persisted beyond what a URL-based image entry already stores.
- **No change to `POST /upload/image`**: that single-file, product-agnostic endpoint (used by Category/Banner image fields too) is untouched — this change is specific to the product create/update routes' own multipart handling, not a replacement for the shared upload endpoint.
