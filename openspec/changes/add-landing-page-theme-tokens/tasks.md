## 1. The token shape

- [x] 1.1 Widen `landingThemeSchema` in `server/src/app/module/landing-page/landing-page.validation.ts` to the eight tokens — `accent`, `accentSoft`, `accentContrast`, `surface`, `surfaceAlt`, `text`, `textMuted`, `border` — each an optional strict hex, `displayFont` unchanged beside them. Verify a stored `{ accent }` still parses, a full set parses, and a non-colour value is refused.
- [x] 1.2 Mirror the shape into `landing-page.interface.ts`, `nextjs/src/types/landing-page.ts` and `admin/src/lib/api/landing-pages.ts`. Verify `verify-landing-page-shapes.ts` passes, and that it FAILS when one token is renamed in one copy only.
- [x] 1.3 Confirm no migration is needed — `theme` is already a Json column and the keys are additive. Verify a page stored with `{ accent }` before this change reads back unchanged.

## 2. CSS defaults — the fallbacks that make "sets nothing" identical to today

- [x] 2.1 Declare the eight `--lp-*` custom properties in `nextjs/src/app/globals.css`, each defaulting to the value the page renders TODAY (`--lp-text: #111827` for `gray-900`, `--lp-surface: #fff`, and so on). Verify by reading each default against the class it replaces.
- [x] 2.2 Default `--lp-accent-soft` to a `color-mix` of the accent, following the existing `color-mix` use in `globals.css`, so setting only `accent` still yields a coherent page. Verify a page with only `accent` set renders a tinted band rather than a transparent one.
- [x] 2.3 Map the properties to Tailwind utilities (`text-lp-text`, `bg-lp-surface`, `border-lp-border`, …) in the `@theme` block. Verify one utility compiles and resolves in the browser.

## 3. Replace all 95 hardcoded colours

- [x] 3.1 `LandingPageView.tsx` — replace every `gray-*`, `white` and `black` colour class with its token. Verify the file's hardcoded-colour count reaches zero.
- [x] 3.2 `LandingSections.tsx` — same. Verify zero.
- [x] 3.3 `LandingOrderForm.tsx` — same; it holds the largest share. Verify zero, and that the form's focus and error states still read correctly.
- [x] 3.4 `LandingGallery.tsx`, `LandingStickyCta.tsx`, `LandingCountdown.tsx`, `LandingScarcity.tsx`, `LandingOrderCta.tsx` — same. Verify zero across all five.
- [x] 3.5 Map `text-white` to `text-lp-accent-contrast` ONLY where it sits on an accent background; elsewhere it is a surface colour and takes the matching token. Verify each of the five occurrences by reading its context, not by pattern.
- [x] 3.6 Assert the whole directory is clean: a grep for `(text|bg|border|ring|divide)-(gray|white|black|green|amber|red)` over `nextjs/src/components/landing/` returns nothing. Verify by running it.

## 4. Full-width bands

- [x] 4.1 Add a `LandingBand` component taking a surface name and rendering a full-width section with the container inside — the one place the container width, side padding and vertical rhythm are decided (design.md Decision 5). Verify it renders at both phone and desktop width with no horizontal scroll.
- [x] 4.2 Remove the single `max-w-5xl` wrapper from `LandingPageView.tsx` and wrap each section in a band instead. Section ORDER and contents unchanged — only the wrapping moves. Verify the rendered section order matches the previous page exactly.
- [x] 4.3 Assign surfaces so consecutive content sections differ, and the offer block and CTA strips use the accent (design.md Decision 5 — the alternation lives in the view, not in each section). Verify no two adjacent bands share a surface.
- [x] 4.4 Verify the page at 375px: every band spans the viewport, content keeps its side padding, and nothing scrolls horizontally.

## 5. Admin

- [x] 5.1 Replace the single accent text input with the eight tokens, using the existing `color-input` primitive rather than a text box. Verify each saves and reloads.
- [x] 5.2 Show the tokens together as a live preview — a small swatch row rendering text on surface on border — so an unreadable combination is visible before saving (design.md — Risks). Verify grey-on-grey is visibly wrong in the preview.
- [x] 5.3 Leave every token blank-able, and label the blank state as "your shop's default" rather than as empty. Verify clearing a token returns that colour to its default on the storefront.

## 6. Verification

- [x] 6.1 Extend `verify-landing-page-shapes.ts` with the token names, so a renamed token fails the same way a renamed field does. Verify it fails on a deliberate rename and passes after.
- [x] 6.2 Add the hardcoded-colour grep from 3.6 to that script, so a colour typed directly into a landing component fails a check rather than being noticed in review. Verify by adding one temporarily.
- [x] 6.3 Assert the feature-off path: a page with no `theme` at all renders in the documented defaults. Verify by reading the rendered HTML for the default values.
- [x] 6.4 Extend `seed-bangla-landing-page.ts` with a full token set in the reference campaign's amber, so the banded, themed page can be reviewed whole. Verify every band renders in its intended surface.
- [x] 6.5 Run both test suites, all landing verify scripts, and both typechecks. Verify no regression.
