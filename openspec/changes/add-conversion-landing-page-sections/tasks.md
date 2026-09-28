## 1. Schema and validation — the shapes everything else reads

- [x] 1.1 Add the columns to `server/prisma/schema/LandingPage.prisma`, all optional: `packages`, `whyUs`, `usageIdeas` (Json), `offerEndsAt` (DateTime?), `stopOrdersAtDeadline` (Boolean default false), `scarcityTarget` (Int?), `orderPhone` (String?), and a theme block (accent colour, display font). `productId` stays REQUIRED and restricted — see design.md Decision 1. Use `///` comments stating why each exists. Verify `npx prisma validate`.
- [x] 1.2 Amend the model's header comment, which currently says "NO PRICE LIVES HERE". A package authors its own price, and design.md Decision 1 explains why that does not reintroduce the bug the rule was written against. Leaving the comment contradicting the code is worse than either. Verify by reading it against the new schema.
- [x] 1.3 Add a `scarcityTakenCount` NOWHERE. Confirm by grep that no column, field or payload can carry a seeded count — the figure is counted on read (design.md Decision 3). Verify the schema and validation files contain no such field.
- [x] 1.4 Add Zod schemas to `landing-page.validation.ts`: `packageSchema` (stable slug `key`, label, productId, price, optional freeGiftText, optional badge, optional `preselected`), `whyUsSchema`, `usageIdeaSchema`, plus item caps beside the existing `MAX_*` constants. Enforce unique package keys and at most one `preselected`. Verify by unit-parsing a valid list, a duplicate-key list (rejected) and a two-preselected list (rejected).
- [x] 1.5 Extend `quotesSchema` with an optional `imageUrl`, and relax `text` so a screenshot-only quote is valid while a text-only one still is. Verify all three shapes parse: text-only, image-only, both.
- [x] 1.6 Add the accent colour as a STRICT hex and the display font as a rebuilt-from-components URL, following `theme`'s posture in `store-setting.validation.ts` — a value that could carry further style declarations must be refused. Verify by unit-parsing `#e18820` (accepted) and `red; background:url(...)` (rejected).
- [x] 1.7 Run the migration, then **delete the three trigram `DROP INDEX` lines** for `Product_name_trgm_idx`, `Product_sku_trgm_idx`, `Brand_name_trgm_idx` and carry forward the NOTE block. Verify by grepping the generated SQL for executable `DROP INDEX` and finding none.
- [x] 1.8 Add the package reference to `Order` — the key plus a captured snapshot of the label and price, like `landingPageTitle` is captured. Verify an order survives its package being deleted and still names what was sold.

## 2. The one resolver

- [x] 2.1 Add `resolveLandingPackage(page, packageKey)` to `landing-page.service.ts`, returning `{ productId, unitPrice, label, freeGiftText, packageKey }`. A page with no packages returns its bound product and that product's own price; an unknown key is refused; a null key on a page WITH packages resolves to the preselected one. Verify each of the four cases by unit call.
- [x] 2.2 Route `buildProductSnapshot` through it, so the rendered page prices the selected package. Verify a page with two packages snapshots each correctly.
- [x] 2.3 Route `quoteLandingPageOrder` (`~:611`) through it, replacing the direct `landingPage.productId` lookup. Verify the quote for each package matches that package's authored price times quantity.
- [x] 2.4 Route `placeLandingPageOrder` through it, and refuse a package key not on the page. Verify: a valid package orders its own product at its own price; an unknown key is refused with no order created.
- [x] 2.5 **The regression that already happened once:** assert quote and placement agree for EVERY package on a page, including while a campaign runs — a mismatch makes `expectedTotal` fail and breaks every order from the page (see the comment at `landing-page.service.ts:~620`). Verify by script across a fixture page with two packages and an active campaign.
- [x] 2.6 Add `npx tsx scripts/verify-landing-packages.ts` covering 2.1–2.5 on `__verify_*` rows with cleanup in a `finally`. Verify it passes.

## 3. Deadline and scarcity

- [x] 3.1 Serve `offerEndsAt` on the public page read. Do NOT serve a precomputed remainder — the page is cached, so a server-rendered remainder is wrong the moment it is stored (design.md Decision 2). Verify the payload carries an absolute instant.
- [x] 3.2 Refuse an order past the deadline in `placeLandingPageOrder` when `stopOrdersAtDeadline` is set, against the SERVER's clock. Verify: past the deadline with the flag set → refused naming the ended offer; past it without the flag → accepted.
- [x] 3.3 Compute the scarcity taken-count from the page's real `Order` count on read, served by `@@index([landingPageId])`. No stored counter. Verify the figure rises by one after an order is placed.
- [x] 3.4 Stop presenting the offer as available once the target is met — no negative or clamped remainder. Verify at target-1, target, and target+1 orders.
- [x] 3.5 Add `npx tsx scripts/verify-landing-urgency.ts` pinning 3.2–3.4 plus the absence of any seedable count. Verify it passes.

## 4. Storefront — sections

- [x] 4.1 Build the package selector in `nextjs/src/components/landing/` — cards with label, price, struck-through compare price, free-gift line and badge. Changing selection updates every stated price on the page. Verify against the reference layout at mobile and desktop width.
- [x] 4.2 Build the countdown as a client island computing from the absolute instant, stopping at zero and never restarting. Reserve its space and show the deadline date until hydration, so it does not flash empty (design.md — Risks). Verify it stops rather than restarts when the deadline passes with the page open.
- [x] 4.3 Build the scarcity line and progress bar from the served figures. Verify it renders nothing when no target is configured.
- [x] 4.4 Build the numbered "why us" grid and the usage-ideas grid. Each renders nothing — no heading, no spacing — when its list is empty. Verify with both lists empty.
- [x] 4.5 Render image quotes in `LandingSections.tsx`: image-only shows the image alone with no empty text or rating beside it; text-only renders exactly as before. Verify all three shapes.
- [x] 4.6 Add the repeated CTAs after the hero, the benefits and the content sections, each scrolling to the ONE form with the package selection intact. Verify from each CTA.
- [x] 4.7 Add the phone-order action beside the form, rendered only when a number is configured. Verify both states.
- [x] 4.8 Widen `LandingStickyCta.tsx`: mobile only, states the selected package's price, and hides while the order form is in view (design.md Decision 5 — it otherwise covers the submit button). Verify on a phone viewport that the submit button is never obscured.
- [x] 4.9 Apply the page's accent and display font as CSS custom properties on the page's own wrapper. Verify the shop's chrome is unchanged and the theme does not leak to any other route.

## 5. Admin

- [x] 5.1 Add the packages editor to `landing-page-form-page.tsx` — add/remove/reorder, generating a stable key on creation and never rewriting it on edit. Verify a reorder does not change any existing key.
- [x] 5.2 Show each package's product's CURRENT price beside the authored one and warn when they differ (design.md — Risks: authored price drift). Verify the warning appears after editing the product's price.
- [x] 5.3 Add editors for `whyUs`, `usageIdeas`, the deadline + enforcement toggle, the scarcity target, the phone number and the theme block. Verify each saves and reloads.
- [x] 5.4 Add the image field to the quotes editor. Verify a screenshot-only quote saves.
- [x] 5.5 Show which package each order was for, on the order detail page. Verify against an order placed from a two-package page.
- [x] 5.6 Surface per-package orders and revenue (design.md — Open Questions leaves placement open; either satisfies this). Verify the figures split correctly across two packages.

## 6. Cross-cutting

- [x] 6.1 Mirror all new shapes into `nextjs/src/types/landing-page.ts` and `admin/src/lib/api/landing-pages.ts`. Verify both workspaces type-check.
- [x] 6.2 Add `npx tsx scripts/verify-landing-page-shapes.ts` asserting the three hand-synced copies agree, and that it FAILS when a field is renamed in one place only. Verify both directions.
- [x] 6.3 Assert the feature-off path is unchanged: a page with none of these columns set renders exactly as it does today and orders through the identical code path. Verify by script.
- [x] 6.4 Run `npm run lint --workspace server`, both test suites, and the existing `verify-landing-page.ts` (39 checks) to confirm no regression. Verify all pass.
- [x] 6.5 Seed a reference page exercising every new section, so the design can be reviewed whole — extend `scripts/seed-bangla-landing-page.ts` rather than adding a second seed. Verify every new section renders on it.
