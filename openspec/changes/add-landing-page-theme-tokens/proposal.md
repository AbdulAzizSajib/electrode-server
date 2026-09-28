## Why

`add-conversion-landing-page-sections` gave a campaign page an `accent` colour, and it does less than it appears to. The landing components carry **95 hardcoded colour classes** — 27 `text-gray-900`, 11 `border-gray-200`, 10 `bg-white`, and so on down a list of sixteen. Those are literal Tailwind values, not theme tokens, so the accent recolours only the ~35 `brand`/`sale` classes beside them. Every surface, border and body-text colour on the page is frozen at whatever grey was typed when the component was written, and no admin setting can move it.

The merchant's own words for what they want: *"je color gula use korba website er theme er upor, jeno ekjay theki sov color change kora jay."* The current shape cannot do that, and adding a second colour field would not fix it — the problem is that most of the page never asks the theme anything.

The layout has the same cause. Every section sits inside one `max-w-5xl` wrapper (`LandingPageView.tsx:108`), so no section can carry a full-width background of its own. The page reads as one long column in one colour. The reference the merchant is comparing it against alternates full-width bands — a blue offer block, a white reasons block, an orange call-to-action strip, a grey order form — and that alternation is most of why theirs reads as organised and ours does not. A band needs a colour to be a band, which is why these two are one change and not two.

## What Changes

- **A landing page's theme becomes a set of semantic tokens**, not a single accent: `accent`, `accentSoft`, `accentContrast`, `surface`, `surfaceAlt`, `text`, `textMuted`, `border`. Each is optional; each falls back to what the page renders today, so a page that sets none is pixel-identical to before.
- **Every hardcoded colour in the landing components is replaced by a token.** All 95 of them. After this, changing one value in the admin changes the page — which is the thing that is currently impossible.
- **Sections become full-width bands.** The single `max-w-5xl` wrapper is replaced by a per-section band that carries its own background and holds a container inside it. The order is unchanged; only the wrapping moves.
- **Each band declares which surface it uses** — `surface` or `surfaceAlt` for content, `accent` for the offer block and the call-to-action strips — so the alternation is a property of the section rather than a colour typed into it.
- **BREAKING for the stored theme shape:** `theme.accent` becomes one key among several. A stored `{ accent }` keeps working and keeps meaning what it means, so no migration and no backfill; the widening is additive.

## Capabilities

### New Capabilities
<!-- None. This is how the existing landing page renders — its own capability
     already describes the page's theming and its sections. -->

### Modified Capabilities
- `storefront-cms/landing-pages`: Widens the per-page theming requirement from one accent to a token set, and states that every colour the page renders resolves through it. Adds the requirement that sections render as full-width bands whose surface is chosen from those tokens.

## Impact

**Schema (no migration)**
- `LandingPage.theme` is a Json column already, and the new keys are additive inside it. `landing-page.validation.ts` gains the token schema; a stored `{ accent: "#e18820" }` still parses and still means what it meant.

**Code**
- `nextjs/src/components/landing/` — all seven components: 95 colour classes become token-backed classes, and `LandingPageView.tsx` restructures from one wrapper into per-section bands.
- `nextjs/src/app/globals.css` — the landing tokens are declared with their fallbacks, so a page that sets none resolves to today's values.
- `server/src/app/module/landing-page/landing-page.validation.ts` and `.interface.ts` — the widened theme shape.
- `admin/src/features/ui/landing-pages/` — the theme editor grows from one field to the token set, using the existing `color-input` primitive rather than a text box.
- Three hand-synced type copies as usual; `verify-landing-page-shapes.ts` already asserts they agree and will catch a missed one.

**Explicitly out of scope**
- **Changing the shop's own theme.** These tokens are the landing page's, scoped to its wrapper. The storefront's chrome is untouched, and `(landing)` has no chrome, which is what makes per-page theming safe here.
- **A theme picker or preset palettes.** A merchant sets colours; choosing between designed sets is a separate feature.
- **Dark mode.** The tokens would support it; nothing else in the storefront does yet, and adding it here alone would be the only dark surface on the site.
- **Per-section colour overrides.** A section picks `surface` or `surfaceAlt`; it cannot name its own hex. Otherwise the tokens stop being a single point of control, which is the entire point.
