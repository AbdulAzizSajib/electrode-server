## Why

The storefront's scrolling and overlay motion feel abrupt. Scrolling is raw native
stepping with no easing, the entire three-row header stays pinned so a shrinking
slice of the viewport is left for content, and the cart drawer appears and vanishes
with no transition at all because it unmounts itself the instant it closes. Together
these make a catalog that is otherwise complete feel unfinished next to the storefronts
it competes with.

## What Changes

- Introduce momentum-based smooth scrolling across the storefront using the `lenis`
  package, driven by a single client-side provider mounted in the root layout.
- Honour `prefers-reduced-motion`: when the user asks for reduced motion the smooth
  scroll layer stays disabled and native scrolling is used instead.
- Reduce header stickiness from the whole header to only its third row (the category
  nav). The announcement bar and the main logo/search row scroll away normally.
  - **BREAKING** for any page that offsets content by the full header height or relies
    on `scroll-margin`/`scroll-padding` tuned to it — the sticky offset shrinks to the
    nav row's height.
- Give the cart drawer real enter/exit motion: the panel slides in from the right and
  the backdrop fades, and the drawer stays mounted through its exit animation instead
  of unmounting on the first frame.
- Keep the drawer usable while it animates: focus moves into the panel on open, `Escape`
  closes it, and background scrolling is locked while it is open.

## Capabilities

### New Capabilities

- `storefront/smooth-scrolling`: Momentum scrolling behaviour for the storefront,
  its reduced-motion opt-out, and how programmatic scrolls (anchor links, route
  changes) behave while it is active.
- `storefront/header-navigation`: Which header rows persist while scrolling, the
  sticky nav's placement and stacking, and how content offset is preserved.
- `storefront/cart-drawer`: The cart drawer's open/close transitions, mount
  lifecycle across those transitions, and its accessibility behaviour while open.

### Modified Capabilities

<!-- None. openspec/specs/ is currently empty, so every capability above is new. -->

## Impact

- **Dependencies**: adds `lenis` to `electrode-nextjs`.
- **Code**:
  - `src/app/layout.tsx` — mounts the new scroll provider.
  - `src/components/layout/Header.tsx` — sticky moves from the root `<header>` to the nav row.
  - `src/components/layout/CartDrawer.tsx` — transition states replace the early `return null`.
  - `src/app/globals.css` — scroll padding retuned to the nav-row height; reduced-motion rule.
- **Interaction risk**: Lenis takes over the scroll loop, so `position: sticky` and any
  scroll-position reads must be verified against it rather than assumed to work as before.
  The mobile bottom nav, the mega-menu dropdowns, and the body padding that reserves room
  for the bottom nav all sit on this path.
- **Scroll containers**: The cart drawer's own scrollable list must keep scrolling natively
  while Lenis owns the page; nested scroll areas need explicit opt-out.
