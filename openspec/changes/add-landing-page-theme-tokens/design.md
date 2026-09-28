## Context

See proposal.md — Why. This records only what the existing code forces.

Four facts shape the approach:

1. **95 hardcoded colour classes** across the seven files in `nextjs/src/components/landing/` — `text-gray-900` ×27, `border-gray-200` ×11, `bg-white` ×10, `text-gray-600` ×10, and twelve more. They are literal Tailwind values; nothing about them asks the theme anything.
2. **`accent` already works, and already does it the right way.** `add-conversion-landing-page-sections` applies it as a CSS custom property on the page's own wrapper, so `text-brand` and `bg-brand` resolve to the campaign's colour without any component knowing a campaign can be themed. This change extends that mechanism rather than replacing it.
3. **`globals.css` already defines `--color-brand`, `--color-brand-dark`, `--color-accent`, `--color-sale`** and Tailwind 4 maps them to `brand`/`sale` utilities. There is no `tailwind.config.js` — tokens live in CSS, which is where the new ones go.
4. **One `max-w-5xl` wrapper holds every section** (`LandingPageView.tsx:108`), which is exactly why no section can have a background of its own.

## Goals / Non-Goals

**Goals:**
- One place a merchant changes a colour; every use of it moves.
- A page that sets nothing renders byte-identically to today.
- Sections that can carry a background without each knowing a hex.

**Non-Goals:**
- Touching the shop's own theme or its `--color-brand`. The landing tokens shadow theirs inside the page's wrapper and nowhere else.
- Making the storefront's other pages themeable. That is a much larger change with a different blast radius.
- A colour picker with presets, or contrast auto-derivation. See Decision 4.

## Decisions

### Decision 1 — CSS custom properties on the page wrapper, not class-name swapping

The tokens are set as custom properties on the landing page's own wrapper element, exactly as `accent` already is, and the components use utilities that read them. The alternative — passing a palette object down and interpolating class names — was rejected twice over:

- Tailwind cannot see a class name built at runtime, so `bg-${token}` produces no CSS at all. Every possible value would have to be safelisted.
- It would make every landing component take a palette prop, which means every one of them becomes something you cannot render without knowing about theming. The custom-property approach keeps `LandingQuotes` a component that draws quotes.

The wrapper scope is what keeps this from leaking: the properties cascade to the page's own subtree and stop there, so the shop's chrome — which `(landing)` does not render anyway — cannot be reached.

### Decision 2 — eight tokens, named for their ROLE

```
accent          the campaign's colour: buttons, badges, active states
accentSoft      a wash of it: band backgrounds, selected-card fills
accentContrast  what is legible ON accent — usually white
surface         the primary content background
surfaceAlt      the alternating band background
text            body and heading colour
textMuted       secondary copy
border          every rule and card edge
```

Named for what they DO, not what they look like. `surfaceAlt` rather than `gray50` is the whole difference between a token a merchant can repurpose and a second hardcoded value with a nicer name — a merchant who sets `surfaceAlt` to a pale amber has a page that still makes sense, which `gray50` would not.

Eight rather than the three the reference page visibly uses: the 95 classes collapse onto exactly these eight, and a smaller set would leave some of them with nowhere to go — which is how a "token system" ends up with four tokens and sixty hardcoded values beside them.

**`accentContrast` is a token rather than derived.** Deriving legible-on-accent by luminance is a small function and a large liability: it is right most of the time, and the times it is wrong are a white button label on a yellow background that nobody can read. The merchant picks it; the default is white, which is right for the colours campaigns actually use.

### Decision 3 — defaults live in CSS, not in the payload

Each token's fallback is declared in `globals.css` as the value the page renders today. The server sends only what the merchant actually set, and an unset token simply does not appear in the style attribute, so the CSS default applies.

This is what makes "a page that sets nothing is identical to today" true by construction rather than by a table of defaults kept in step by hand. It also means the defaults are visible in one file next to the shop's own, rather than spread across a constant, a type and a form.

### Decision 4 — the tokens are a flat block, not nested

`theme: { accent, accentSoft, surface, ... }` rather than `theme: { colors: { ... }, fonts: { ... } }`. `displayFont` already sits beside `accent` at the top level; nesting the colours now would move it or leave the shape inconsistent, and a flat block of nine keys is not the place where nesting starts to pay.

### Decision 5 — bands are a component, not a pattern to repeat

A `LandingBand` wrapper takes a surface name and renders a full-width section with the container inside. Every section is wrapped in one.

Not left as a class string each section repeats: the wrapper is the one place the container width, the side padding and the vertical rhythm are decided, and eight sections each spelling it out is eight places for them to drift. It also makes "which surface does this section use" a readable prop rather than something to infer from a class list.

The alternation is expressed in `LandingPageView`, where the section order already lives, rather than inside each section — a section does not know what precedes it and cannot decide whether to alternate.

### Decision 6 — mechanical replacement, then verified

The 95 classes map onto the tokens one-for-one:

| from | to |
|---|---|
| `text-gray-900` | `text-lp-text` |
| `text-gray-700`, `text-gray-600`, `text-gray-500`, `text-gray-400` | `text-lp-muted` |
| `bg-white` | `bg-lp-surface` |
| `bg-gray-50`, `bg-gray-100` | `bg-lp-surface-alt` |
| `border-gray-200`, `border-gray-300`, `border-gray-400` | `border-lp-border` |
| `text-white` on an accent | `text-lp-accent-contrast` |

Four grey weights collapsing to one `textMuted` is a deliberate loss of gradation. Keeping four would mean four tokens whose only difference is how grey they are, and a merchant setting all four to shades of their own colour is doing the design system's job by hand. Where a genuine second weight is needed, opacity on the token expresses it.

The check that this was done is a grep for any remaining hardcoded colour in the landing directory, run as part of the verify script — not a reading of the diff.

## Risks / Trade-offs

**A merchant can make the page unreadable** → Eight free-form colours include grey text on grey surface. Not prevented: a contrast validator that refuses a save is a merchant who cannot use their own brand colours, and the storefront's existing theme takes the same position. The admin shows a live preview of the tokens together so the mistake is visible before saving, which is the honest mitigation.

**Four grey weights become one** → Stated in Decision 6. Some hierarchy is lost in places where `text-gray-500` sat beside `text-gray-600`. Judged a fair trade for a token set a merchant can actually reason about.

**`accentSoft` has no good automatic default** → A wash of the accent would need `color-mix`, which the shop's own `globals.css` already uses for exactly this. The default is a `color-mix` of the accent, so setting only `accent` still produces a coherent page — which is the common case and must not require setting eight fields.

**Bands change the page's rhythm** → Full-width backgrounds make the page feel longer even at identical height. That is the intended effect, and it is the reference's effect, but it is a visible change to a page already reviewed. Worth flagging to the merchant rather than discovering together.

## Migration Plan

1. **Tokens and CSS defaults first**, with the components untouched. Nothing renders differently; the properties exist and are unused.
2. **Replace the 95 classes**, file by file, verifying the grep count falls to zero.
3. **Then the bands.** Layout last, so a visual regression is attributable to one step rather than two.
4. **Admin editor last of all** — the shape must be storable before it is editable.
5. **Rollback** is per-step: the tokens are additive, the classes resolve to their CSS defaults, and the bands are a wrapper that can be removed without touching a section's contents.

## Open Questions

- **Whether `displayFont` should gain a body font beside it.** The reference uses two Bengali faces, one for display and one for body. It changes no requirement here and no token; settle it when someone asks for the second face.
