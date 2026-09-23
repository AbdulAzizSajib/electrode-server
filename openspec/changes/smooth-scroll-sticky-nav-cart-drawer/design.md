## Context

See `proposal.md` — Why. Constraints that shape the approach:

- **Next.js 16 App Router.** `src/app/layout.tsx` is an async Server Component that
  awaits `getCurrentUser()` and `getCategoryTree()`. Anything driving a `requestAnimationFrame`
  loop must be a Client Component mounted inside it, not the layout itself.
- **`Header.tsx` is already `sticky top-0 z-40`** on the root `<header>`, so all three
  rows pin together today. The nav row is `hidden … md:block` — desktop-only.
- **The mega-menu dropdowns are `absolute` children of the nav row** at `z-50`. They must
  escape the nav row's box, so the nav row cannot gain `overflow: hidden`.
- **`MobileMenuDrawer` already locks scrolling with `document.body.style.overflow = "hidden"`.**
  That technique stops working once Lenis drives the scroll loop, because Lenis translates
  content rather than relying on the body's own overflow. Any lock must go through Lenis.
- **`globals.css` reserves `padding-bottom` on `body` below `md`** for the fixed mobile
  bottom nav, and `layout.tsx` sets `html.h-full` with `body.flex.min-h-full.flex-col`.
- **`CartDrawer` returns `null` when closed**, so it has no exit frame to animate.

## Goals / Non-Goals

**Goals:**

- One scroll authority for the page, with a single documented opt-out path for nested
  scrollers and overlays.
- Keep `position: sticky` working for the nav row under Lenis, verified rather than assumed.
- Replace the drawer's mount/unmount toggle with a state machine that survives an exit animation.
- Route every scroll-lock through that one authority, so the cart drawer and the existing
  mobile menu drawer cannot disagree about who owns scrolling.

**Non-Goals:**

- Scroll-driven animations, parallax, or reveal-on-scroll effects.
- Changing header layout, spacing, or visual design beyond which rows pin.
- Reworking `MobileMenuDrawer`'s own open/close motion — it is touched only where the
  shared scroll-lock changes.
- A general-purpose modal/focus-trap abstraction. The drawer gets what it needs; extraction
  can follow if a third overlay appears.

## Decisions

### 1. Lenis mounted via a dedicated client provider, not in the root layout

A `SmoothScrollProvider` Client Component wraps `{children}` in `layout.tsx` and owns the
Lenis instance plus its `requestAnimationFrame` loop, creating it on mount and destroying it
on unmount.

*Why:* the root layout is an async Server Component; it cannot hold an effect or a RAF loop.
A provider also gives a single place to expose the instance for the scroll-lock decision below.

*Alternatives considered:* calling Lenis from `Header.tsx` (wrong scope — scrolling is not the
header's concern, and the header would have to outlive route changes to keep the instance);
the `lenis/react` binding (a thin wrapper over the same setup, and we need direct instance
access for locking, so the indirection buys little).

### 2. `position: sticky` is kept — Lenis is configured not to break it

Lenis is initialised **without** wrapper/content elements, so it drives `window` scrolling and
leaves the document's own scroll position authoritative. Under that mode `position: sticky`
continues to resolve against the real scroll offset, so the nav row needs no JS.

*Why:* the alternative — Lenis's transform-based wrapper mode — moves content with a CSS
transform, which establishes a containing block and **silently breaks `position: sticky`**
along with the mega-menu's `absolute` positioning. Keeping native scroll semantics is what
makes decisions 3 and 4 possible at all.

*Consequence:* this must be verified in the browser, not assumed. It is called out as a task
and as a risk below, because the entire sticky-nav requirement rests on it.

### 3. Sticky moves from `<header>` to the nav row, which is promoted to a sibling

`sticky top-0 z-40` is removed from the root `<header>` and applied to the nav row instead.
The announcement bar and main row then scroll away naturally, with no scroll listeners, no
height measurement, and no layout-shift compensation — the rows above simply leave the viewport.

**The nav row must be a sibling of `<header>`, not a child of it.** A sticky element can only
travel within its own parent's box, and `<header>` is exactly as tall as the rows it contains —
left nested, the nav has zero distance to stick through and scrolls away like everything else.
`Header.tsx` therefore returns a fragment holding `<header>` and `<nav>` side by side, so the
nav becomes a direct child of the body's flex column and sticks against the page.

*Found during implementation:* the first attempt kept the nav nested and did not stick at all.
The `<header>`/`<nav>` split is what makes this decision work.

*Why:* it satisfies the requirement with the least moving machinery. A JS approach measuring
header height and toggling `fixed` would reintroduce layout shift at the moment of pinning.

*Stacking:* the nav row keeps `z-40`; its dropdowns stay `z-50`; overlays (cart drawer,
mobile menu) sit at `z-50` or above so they cover the pinned row, per the header-navigation spec.

*Offset:* `scroll-padding-top` in `globals.css` is retuned from the full header height to the
nav row's height, so anchored content lands below the pinned row and not beneath a header that
is no longer there.

### 4. Scroll-lock goes through Lenis, replacing the `body.overflow` idiom

A shared helper locks scrolling by calling `lenis.stop()` and unlocks with `lenis.start()`,
retaining `overflow: hidden` on the body as the reduced-motion/no-Lenis fallback. `CartDrawer`
and `MobileMenuDrawer` both use it.

*Why:* with Lenis running, `body { overflow: hidden }` alone no longer stops the page — Lenis
keeps applying its own scroll. Leaving `MobileMenuDrawer` on the old idiom would make it
regress the moment Lenis ships, so it is migrated in the same change rather than left broken.

*Nested scrollers* (the drawer's item list, dropdown lists) are marked with Lenis's
`data-lenis-prevent`, which stops Lenis claiming wheel events over them so they scroll natively.

### 5. Drawer visibility becomes a three-state machine, driven by CSS transitions

`CartDrawer` stops returning `null` on `isOpen === false`. It tracks `closed → open → closing`:
`closed` renders nothing; `open` renders at rest; `closing` renders in the exit position and
returns to `closed` on `transitionend` (with a timeout fallback so a dropped `transitionend`
cannot strand the drawer on screen). Reopening while `closing` returns directly to `open`,
satisfying the reopen-mid-close scenario.

*Why CSS transitions over an animation library:* the storefront has no animation dependency
today, and translate/opacity transitions are compositor-driven and enough for a slide-and-fade.
Adding one would be a second new dependency for one component.

*Reduced motion:* the transition is disabled under `prefers-reduced-motion: reduce`; the state
machine still runs, so the drawer opens and closes instantly and correctly.

*Why not keep it mounted always:* a permanently mounted drawer must be made inert — hidden from
the accessibility tree and untabbable — or it violates the "closed drawer is inert" requirement.
`closed` rendering nothing gets that for free.

### 6. Focus management is added to the drawer

On open, focus moves into the panel; a keydown handler cycles `Tab` within it; on close, focus
returns to the opener. `Escape` closes.

*Why now:* the cart-drawer spec requires it, and the drawer is being rewritten anyway. Doing it
in a later pass would mean touching the same lifecycle code twice.

## Risks / Trade-offs

- **Lenis breaks `position: sticky`, invalidating decision 3** → The window-scroll mode in
  decision 2 is chosen specifically to avoid it. Verify the pinned nav on desktop *before*
  building anything on top of it; if it fails, the fallback is a JS sticky nav (measure header
  height, toggle `fixed`, compensate the resulting layout shift with a spacer).

- **Lenis interferes with anchor links or route-change scroll restoration** → Anchor and
  route-change behaviour are covered by explicit spec scenarios; both are on the verification
  list. Lenis exposes `scrollTo` for programmatic scrolls if the native path misbehaves.

- **The mobile bottom nav or `body` padding shifts under Lenis** → Both are `fixed`/`body`-level
  and unaffected by window-scroll mode, but they are on the mobile verification pass since
  `globals.css` couples them to viewport height.

- **Migrating `MobileMenuDrawer`'s scroll-lock regresses a working component** → It is a
  narrow, mechanical substitution (one `useEffect` body) and the drawer's own behaviour is
  otherwise untouched. It ships in this change precisely so the two lock strategies never
  coexist.

- **Momentum scrolling is a subjective feel, and can read as sluggish** → Lenis's duration and
  easing are the two tuning knobs; they are worth a pass on a real trackpad and a real phone
  rather than only in a desktop browser.

- **~3 KB gzipped added to every route, and one more dependency to keep current** → Accepted:
  this was chosen over the zero-cost CSS-only option deliberately, for the momentum feel the
  CSS approach cannot produce.

- **`transitionend` may not fire if the drawer is hidden mid-transition** (e.g. a route change
  unmounts its ancestor) → the timeout fallback in decision 5 returns the machine to `closed`
  regardless.

## Migration Plan

Additive and reversible; no data or API changes.

1. Add `lenis`, mount the provider, verify sticky/anchor/route-restore behaviour before
   proceeding — this is the gate for everything else.
2. Move the sticky to the nav row and retune `scroll-padding-top`.
3. Introduce the shared scroll-lock and migrate both drawers to it together.
4. Rewrite the cart drawer's lifecycle and add its transitions and focus handling.

*Rollback:* unmounting the provider and removing the dependency restores native scrolling; the
sticky and drawer changes stand on their own and can be reverted independently.

## Open Questions

- Lenis's exact `duration`/easing values are left to a tuning pass during implementation; they
  affect feel only, not the specs or the task breakdown.
