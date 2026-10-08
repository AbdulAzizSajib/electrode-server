## 1. Server

- [x] 1.1 In `server/src/app/module/store-setting/store-setting.validation.ts`, add `cardBackground: hexColorSchema.nullable().optional()` to `themeSchema`, with a comment giving the three states (design.md Decision 1). Verify `npm run lint --workspace server` passes.
- [x] 1.2 In `store-setting.service.ts` theme resolution, carry a stored `cardBackground` forward when the payload omits it, and drop the key when the payload sends `null`, beside the existing `adminFont` handling. Verify with task 1.4.
- [x] 1.3 Update the `theme` doc comment in `prisma/schema/StoreSetting.prisma` to list `cardBackground` (optional, unset = default look). Do not add it to `DEFAULT_THEME`. Verify `npx prisma validate` passes (no migration).
- [x] 1.4 Add `server/scripts/verify-card-background.ts` (service imported directly; snapshots and restores the singleton's `theme` in a `finally`) asserting:
  - a theme save with `cardBackground: "#fff9f2"` stores it;
  - a later save without the key keeps it;
  - `null` removes it;
  - `"red; color: x"` is rejected with a message naming the card background;
  - the public read has no `cardBackground` when unset.

  Verify `npx tsx scripts/verify-card-background.ts` prints only PASS lines.
- [x] 1.5 Add a `cardBackground` example to the Postman collection's `PATCH /settings` theme body. Verify the collection is valid JSON.

## 2. Storefront

- [x] 2.1 Add `cardBackground?: string | null` to `Theme` in `nextjs/src/types/store-settings.ts`. In `lib/theme.ts` `themeStyle()`, write `--color-card` only when it is a valid hex (Decision 2). In `app/globals.css` add a comment that `--color-card` intentionally has no `:root` value. Verify `npm run lint --workspace nextjs` passes.
- [ ] 2.2 Replace the background classes per design.md Decision 3:
  - `ProductCard.tsx:170` and `Skeleton.tsx:40` → `bg-(--color-card,#ffffff)`;
  - `CategoryTile.tsx:43` → `bg-(--color-card,var(--color-gray-50))` with no hover background (removed on request);
  - `HomeSkeletons.tsx:110,148` → the category fallback;
  - `Testimonials.tsx:88` → the white fallback.

  Verify on an unconfigured shop that each looks unchanged (screenshots before/after at 390px and 1280px).
- [ ] 2.3 Give brand logos a tile in `BrandBar.tsx` (Decision 4): rounded card with padding, card background with white fallback and `border-gray-200`, logo `object-contain`; raise the section `min-h` by the added padding. Verify the brand row does not jump when the marquee mounts.
- [ ] 2.4 Give blog cards a surface in `BlogSection.tsx` and `app/(shop)/blogs/page.tsx` (Decision 4). Verify both lists match and cards stay equal height in the slider.
- [x] 2.5 Add a `lib/theme.test.ts` case: `themeStyle` emits `--color-card` for a valid hex and omits it for `undefined`, `null` and `"red; x"`. Verify `npm run test --workspace nextjs -- src/lib/theme.test.ts` passes.

## 3. Admin

- [x] 3.1 Add `cardBackground?: string | null` to `Theme` in `admin/src/lib/api/store-settings.ts` (do not add it to `THEME_COLOR_FIELDS`). Verify `npm run build --workspace admin` type-checks (run by the user).
- [ ] 3.2 In `features/ui/site-settings/site-settings-page.tsx`, add a "Card background" picker to the Colours section with a "Use default" control (Decision 5):
  - unset shows the default description;
  - choosing a colour sets the hex;
  - "Use default" sets `null`;
  - the theme save sends the key as the draft holds it.

  Verify: set a colour, save, reload (persists); choose "Use default", save, reload (cleared).
- [x] 3.3 Add the contrast note "Card text on card" using `contrastRatio(cardBackground, '#111827')`, shown only when a colour is set, warning below 4.5:1 without blocking the save. Verify with `#3D2314` (warns) and `#FFF9F2` (passes).
- [ ] 3.4 Add or extend a site-settings test: the card picker's "Use default" sends `null`, a picked colour sends the hex, and the contrast note appears only when set. Verify `npm run test --workspace admin -- src/features/ui/site-settings` passes.

## 4. End to end

- [ ] 4.1 On the Sweet Bites shop, set Card background to a cream close to the page (for example `#FFF4E6`) and confirm product cards, category tiles, brand tiles, testimonial and blog cards all follow it, and that "Use default" restores white product cards and grey category tiles. Ask the user to build all three apps and confirm.
