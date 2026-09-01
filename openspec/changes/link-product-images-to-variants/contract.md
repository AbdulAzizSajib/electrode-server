# Verified contract: image ↔ variant association

Every shape below was exercised against the running server and the real
database during task 8, not transcribed from the proposal. The admin
(`link-product-images-to-variants-admin`) and storefront
(`sync-product-gallery-with-variant`) changes should build against this file.

## Fields

On each entry of `images[]` (and each entry of `imageSlots[]`, which describes
the correspondingly-positioned uploaded file):

| Field | Type | Meaning |
| --- | --- | --- |
| `variantId` | `string?` | The variant this image depicts, by id. |
| `variantIndex` | `int?` (≥ 0) | The variant this image depicts, by position in the **same request's** `variants` array. |

Rules, all verified:

- Both omitted → the image is **shared**; it is stored with `variantId: null`.
- `variantId` **wins** when both are present; `variantIndex` is not consulted.
- On **create**, only `variantIndex` can resolve — no variant has an id yet. A
  `variantId` on create is always rejected, because it cannot name a variant of
  a product that does not exist.
- On **update**, `variantId` must name a **surviving** variant: one resubmitted
  with its `id`. Naming a variant the same request drops is a 400.
- When an update omits `variants` entirely, the existing variants are untouched
  and a `variantIndex` resolves against that existing set, ordered by creation.
- The association is **rewritten on every image sync**, so resubmitting an image
  with neither field clears it back to shared.

## Create — assign by index

`POST /products`

```jsonc
{
  "name": "TWS Earbuds XY-70",
  "type": "VARIABLE",
  "price": 2000,
  "variants": [
    { "name": "Mint", "sku": "tws-mint", "price": 2000, "stockQuantity": 5 },  // index 0
    { "name": "Navy", "sku": "tws-navy", "price": 2100, "stockQuantity": 4 }   // index 1
  ],
  "images": [
    { "url": "https://…/mint-1.jpg", "sortOrder": 0, "variantIndex": 0 },
    { "url": "https://…/mint-2.jpg", "sortOrder": 1, "variantIndex": 0 },
    { "url": "https://…/navy-1.jpg", "sortOrder": 2, "variantIndex": 1 },
    { "url": "https://…/case.jpg",   "sortOrder": 3, "isPrimary": true }       // shared
  ]
}
```

→ `201`. Mint gets two images, Navy one, the case photo `variantId: null`.

## Update — assign by id

`PATCH /products/:id`

```jsonc
{
  "variants": [
    { "id": "<mintId>", "name": "Mint", "sku": "tws-mint", "price": 2000 },
    { "id": "<navyId>", "name": "Navy", "sku": "tws-navy", "price": 2100 }
  ],
  "images": [
    { "id": "<imgA>", "url": "…", "sortOrder": 0, "variantId": "<navyId>" },  // reassigned
    { "id": "<imgB>", "url": "…", "sortOrder": 1 },                            // cleared to shared
    { "id": "<imgC>", "url": "…", "sortOrder": 2, "variantId": "<navyId>" }
  ]
}
```

Unchanged from before: an image whose `id` is absent from `images[]` is
**deleted**. A variant absent from `variants[]` is deleted too — but its images
are **kept** and become shared, never deleted.

## Uploads — multipart

`POST` / `PATCH` as `multipart/form-data`, with the JSON above in the `data`
field and files in the repeated `images` field. `imageSlots[i]` describes
`files[i]` positionally and now carries the same two fields:

```jsonc
// inside `data`
"imageSlots": [
  { "altText": "mint shot", "isPrimary": true, "variantIndex": 0 },  // create
  { "altText": "navy shot", "variantId": "<navyId>" }                // update
]
```

Uploaded files are appended after any URL-based `images[]` entries. A slot
cannot override the uploaded file's `url`.

## Responses

**Public detail** (`GET /products/:slug`) and **admin detail**
(`GET /products/admin/:id`): every entry of `images[]` carries `variantId`,
either a string naming a variant present in the same response's `variants[]`,
or `null`. Verified that non-null ids always resolve within the same payload,
and that `costPrice` remains absent from the public payload.

**Listings are deliberately unchanged** — `GET /products`, the admin listing and
`GET /products/search` still return only the primary image and do **not** carry
`variantId`. A card has no variant selector, so the field would be dead weight
on every row (design Decision 8). A client needing the association must fetch
the detail endpoint.

## `ProductVariant.image` is now derived

Still present and still what `cart.service.ts` and `wishlist.service.ts` read.
After any image sync it is set to the **lowest-`sortOrder` linked image** of that
variant. A variant with no linked images keeps whatever the payload set, so an
existing client that writes `image` directly is unaffected.

Consequence for clients: do not author `variant.image` alongside linked images
and expect it to stick — link the image instead and let it derive.

## Errors

Both are `400`, thrown before the transaction opens, so **nothing is written**:

```
Image at position 0 references variant index 5, but only 1 variant(s) were submitted
Image at position 0 references variant <id>, which does not belong to this product
```
