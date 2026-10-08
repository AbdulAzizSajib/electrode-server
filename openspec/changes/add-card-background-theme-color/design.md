## Context

How the six theme colours travel today:

- **Stored** as one Json object, `StoreSetting.theme`, validated by `themeSchema` (`store-setting.validation.ts`), which is `.strict()` with every colour required: the theme is written whole.
- **Read** publicly merged over `DEFAULT_THEME` (`store-setting.service.ts:773`), so an unconfigured key reads as its default.
- **Written** by `resolveThemePayload` (`store-setting.service.ts:~1110`), which already carries `adminFont` forward when a save omits it.
- **Applied** by `themeStyle()` (`nextjs/src/lib/theme.ts:99`) as inline CSS variables on `<html>`; `globals.css` holds `:root` fallbacks and maps them to Tailwind utilities in `@theme inline` (`bg-brand`, `text-sale`, …).
- **Edited** in the admin's Site Setting page: `THEME_COLOR_FIELDS` (`admin/src/lib/api/store-settings.ts:1145`) drives six required pickers; `contrast.ts` computes the AA notes under them.

The card surfaces in scope, as they are now (from the audit):

| Surface | File | Today |
|---|---|---|
| Product card | `components/product/ProductCard.tsx:170` | `bg-white border-gray-200` |
| Product card skeleton | `components/ui/Skeleton.tsx:40` | `bg-white border-gray-200` |
| Category tile | `components/home/categories/CategoryTile.tsx:43` | `bg-gray-50 hover:bg-gray-100`, no border |
| Category tile skeletons | `components/home/HomeSkeletons.tsx:110,148` | `bg-gray-50` |
| Testimonial card | `components/home/Testimonials.tsx:88` | `bg-white border-gray-100 shadow-sm` |
| Brand logo | `components/home/BrandBar.tsx:34` | no surface: logo on the page |
| Blog card | `components/home/BlogSection.tsx:~93`, `app/(shop)/blogs/page.tsx` | no surface: text on the page |

## Goals / Non-Goals

**Goals:**
- One merchant colour that every browsing card follows.
- A shop that never sets it looks exactly as it does today, for every surface that exists today.
- No existing API caller breaks.

**Non-Goals:**
- Themeable text, borders, state colours, or cart/checkout/account panels (inventory below).
- Changing the cards' text colours. They stay fixed dark greys; the contrast note is how a merchant is warned off a card colour that defeats them.

## Decisions

### 1. `cardBackground` is optional and nullable in the theme: three real states

`themeSchema` gains `cardBackground: hexColorSchema.nullable().optional()`:
- **omitted**: keep what is stored (the service carries it forward, exactly as it does `adminFont`);
- **a hex value**: set it;
- **`null`**: clear it, so the shop returns to the default look.

This is the `.nullable().optional()` case CLAUDE.md reserves for a column with three meaningful states. Without `null` there would be no way back to the default once a colour was set, because omission means "unchanged".

It is **not** added to `DEFAULT_THEME`. "Unset" is a distinct state that the storefront renders differently per surface (Decision 3), and a stored default would erase that distinction on the first read. The public read therefore returns no `cardBackground` until one is set, and the service stores none when `null` is sent.

*Alternative considered:* a required key with a `#ffffff` default. Rejected: it would 400 every existing caller of the strict theme schema, and it could not express "keep category tiles grey and product cards white", which is today's look.

### 2. `--color-card` is written only when set, and has no `:root` default

`themeStyle()` adds `--color-card` to the inline style on `<html>` only when `theme.cardBackground` is a valid hex. `globals.css` deliberately gets **no** `:root` value for it; a comment there says so. A `:root` default would make every fallback below unreachable.

### 3. Each surface carries its own fallback for "unset"

Surfaces read the variable with a fallback equal to their look today:

- product card, card skeleton, testimonial card: `bg-(--color-card,#ffffff)`
- category tile and its skeletons: `bg-(--color-card,var(--color-gray-50))`
- **new** brand tiles and blog card surfaces: `bg-(--color-card,#ffffff)` plus `border border-gray-200`, the product card's look

So unset is pixel-identical for every existing surface, and the moment a colour is set all of them agree.

The category tile has **no hover background** (changed during apply, on request). It was first planned as a `color-mix` darkening of the tile's own colour, but a second colour appearing under the cursor read as a glitch. Dropping it also removes today's `hover:bg-gray-100`, the one existing visual this change alters, and only on hover.

*Alternative considered:* a single `bg-card` utility via `@theme inline`. Rejected because one utility can carry only one fallback, and the existing surfaces need two (white and grey).

### 4. Brand tiles and blog cards gain a surface

- **Brand tile**: the existing `h-12 w-32` logo box becomes a rounded card (`rounded-xl p-3`, card background, light border) with the logo `object-contain` inside. The marquee row keeps its gap; the section's `min-h` grows by the added padding so the server render does not shift when the marquee mounts.
- **Blog card**: the `<article>` gains `rounded-xl p-3`, the card background and a light border; the image keeps its own rounded corners inside. Same change on the `/blogs` index so the two lists match.

### 5. Admin: a separate optional picker, not a seventh required field

`THEME_COLOR_FIELDS` stays the six required colours. The card colour gets its own picker in the same Colours section with a **"Use default"** control: when chosen, the swatch shows the default treatment ("White product cards, grey category tiles") and the save sends `null`. Picking a colour sends the hex.

The contrast note uses `contrastRatio(cardBackground, '#111827')`, gray-900, the colour of card titles. It is shown only when a card colour is set (the spec's "no warning when unset"). It warns below 4.5:1 and never blocks the save.

The admin read returns the stored row as is (CLAUDE.md's settings-editor pattern), so a missing key correctly shows as "Use default".

## Risks / Trade-offs

- **A dark card colour makes card text unreadable**, because text stays fixed dark grey → the contrast warning (spec), and the inventory below records themeable text as the follow-up.
- **Category tiles no longer change colour on hover**, a small visible change for every shop → requested (Decision 3); the tile is still a link and the cursor still shows it.
- **Brand and blog cards change look on every shop**, because they are new surfaces → stated in the proposal; they take the product card's existing look so the page stays coherent.
- **The Tailwind arbitrary values (`bg-(--color-card,…)`) are long** → each appears in under ten places; a utility cannot carry two fallbacks (Decision 3).

## Migration Plan

No database migration; `theme` is Json. Deploy server, then admin and storefront in any order: an old storefront ignores the new key, and an old admin omits it, which the server carries forward. Rollback is a revert; a stored `cardBackground` is simply ignored by old code.

## Hard-coded colour inventory (for later changes)

From the audit of `nextjs/src` outside `components/landing/`: **968 Tailwind palette classes, 19 literal hex classes, 3 rgba shadows.** None is reachable from the admin.

| Group | Approx. count | Notes |
|---|---|---|
| Text greys (`text-gray-900/700/600/500/400`) | ~465 | Headings and body copy bypass the theme's `foreground`, which only reaches text that sets no colour of its own (rare) |
| White text on brand fills | 72 | Assumes a dark brand; no "on-brand" contrast colour exists (landing pages have `--lp-accent-contrast`) |
| Borders (`border-gray-100/200/300`) | ~158 | Inputs, cards, dividers |
| Surfaces (`bg-white`, `bg-gray-50/100/200`, overlays) | ~158 | Four inconsistent card patterns; this change themes the browsing cards only |
| State colours (red, green, amber, blue, indigo) | ~110 | Green savings lines, red errors, amber stock, order status badges |
| Literal hex that should follow the theme | 13 | Deal of the Week gradient `#eef2fc/#f4f7fe/#e9effd` (a blue wash from an old brand), hero loading tints `#f2efe9/#eef1fb/#eaf3ec` (10 uses), selected option `bg-blue-50` |
| Deliberate third-party colours | ~11 | WhatsApp `#25D366`, Messenger `#0084FF`, Google logo, agency logo `#5cc73f` and plate: correct to leave fixed |

Notable inconsistencies:
- Discount badge `bg-sale` on product cards but `bg-brand` on product detail and quick view.
- `bg-accent text-black` on the newsletter and search buttons breaks with a dark accent.
- Checkout and account pages use `lp-*` landing tokens at their fixed defaults, so they never follow the shop theme.

Heaviest files: `CheckoutForm.tsx` (129), `ProductDetail.tsx` (66), `OrderSummaryCard.tsx` (34), `MobileMenuDrawer.tsx` (29), `MyReviewsView.tsx` (29), `CompareTable.tsx` (27), `CartView.tsx` (24), `AddressList.tsx`, `WishlistView.tsx`, `account/orders/page.tsx` (23 each).
