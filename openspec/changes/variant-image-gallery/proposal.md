## Why

বর্তমানে product create করার সময় image শুধুমাত্র product-level single top-level input field-এর মাধ্যমে দেওয়া হয়। variant-based product-এর (যেমন color/size ভিত্তিক TWS) ক্ষেত্রে প্রতিটা variant-এর জন্য আলাদা image দরকার হতে পারে, কারণ customer variant select করলে সেই variant-এর নির্দিষ্ট image দেখতে চায়।

## What Changes

- Product variant-এর সাথে আলাদা image(s) link করার ব্যবস্থা যোগ হবে
- Variant section-এ `Image(s)` ফিল্ড যুক্ত হবে — প্রতি variant-এ একাধিক image (gallery) আপলোড করা যাবে
- Variant-level image optional: না দিলে product-এর top-level/main image fallback হিসেবে ব্যবহার হবে
- Product-level top-level image field variant থাকা অবস্থাতেও থেকে যাবে — এটি product-এর cover/thumbnail image হিসেবে কাজ করবে (listing, search, SEO/share preview)
- PDP-তে variant select করলে সেই variant-এর নিজস্ব image(s) override করে দেখাবে
- Migration/backfill প্রয়োজন নেই — পুরনো product গুলো নতুনভাবে তৈরি হবে

## Capabilities

### New Capabilities

- `api/catalog/variant-images`: Product variant-এর সাথে image linking, variant-level image gallery, এবং public API-তে variant-specific image projection

### Modified Capabilities

- `api/catalog`: Product create/update API-তে variant-level image input contractual পরিবর্তন, public product detail response-এ variant-specific image data include হবে

## Impact

- `ProductImage` schema: `variantId` column যোগ (nullable FK to `ProductVariant`)
- `ProductVariant` schema: backwards relation `images` যোগ
- Admin create/update product API: variant-level image input support
- Public product detail API: `variantId` image rows-এ return হবে
- Cart service: variant image resolve করার logic update লাগবে (variant-এর linked image priority পাবে)
