## 1. Smooth scrolling foundation

- [x] 1.1 Add `lenis` to `electrode-nextjs` dependencies and install
- [x] 1.2 Create `SmoothScrollProvider` client component that owns the Lenis instance and its `requestAnimationFrame` loop, initialised in window-scroll mode (no wrapper/content elements) per design decision 2, destroying the instance on unmount
- [x] 1.3 Disable Lenis when `prefers-reduced-motion: reduce` is set, and re-evaluate live when the preference changes mid-session
- [x] 1.4 Expose the Lenis instance through context so overlays can lock/unlock scrolling
- [x] 1.5 Mount `SmoothScrollProvider` around `{children}` in `src/app/layout.tsx`

## 2. Verification gate — must pass before continuing

This gate exists because decisions 3 and 4 assume Lenis leaves native scroll semantics
intact. If 2.1 fails, stop and switch to the JS sticky-nav fallback in design Risks.

- [ ] 2.1 Verify `position: sticky` still pins correctly with Lenis active (the current `sticky` header is a sufficient probe)
- [ ] 2.2 Verify in-page anchor links land on target with Lenis active
- [ ] 2.3 Verify scroll position resets to top on route change, with no offset carried over
- [ ] 2.4 Verify the document scrolls fully to both top and bottom with no unreachable content
- [ ] 2.5 Verify on mobile that the fixed bottom nav stays put and the `body` bottom padding still clears the last row of content

## 3. Sticky category nav

- [x] 3.1 Remove `sticky top-0 z-40` from the root `<header>` in `Header.tsx`
- [x] 3.2 Apply `sticky top-0` plus `z-40` to the nav row, keeping it desktop-only (`hidden … md:block`)
- [ ] 3.3 Confirm the mega-menu dropdowns still render above the pinned row and escape its box uncliped (no `overflow: hidden` introduced on the nav row)
- [x] 3.4 Retune `scroll-padding-top` in `globals.css` from the full header height to the nav row's height
- [ ] 3.5 Verify against the header-navigation spec: scrolled-down state, return-to-top stacking order, a page too short to scroll, and mobile (no pinned row)

## 4. Shared scroll-lock

- [x] 4.1 Add a scroll-lock helper that calls `lenis.stop()`/`lenis.start()`, falling back to `body { overflow: hidden }` when Lenis is inactive (reduced motion or provider absent)
- [x] 4.2 Migrate `MobileMenuDrawer` off its direct `document.body.style.overflow` lock onto the helper
- [ ] 4.3 Verify the mobile menu drawer still blocks background scrolling on touch, including at the ends of its own scrollable content

## 5. Cart drawer transitions

- [x] 5.1 Replace `CartDrawer`'s `if (!isOpen) return null` with the `closed → open → closing` state machine from design decision 5, rendering nothing only while `closed`
- [x] 5.2 Return `closing` to `closed` on `transitionend`, with a timeout fallback so a dropped event cannot strand the drawer on screen
- [x] 5.3 Handle reopening mid-close by returning directly to `open` without flicker
- [x] 5.4 Add the slide (panel, translate) and fade (backdrop, opacity) transitions
- [x] 5.5 Disable those transitions under `prefers-reduced-motion: reduce`, keeping open/close functional
- [x] 5.6 Apply the shared scroll-lock from 4.1 while the drawer is open
- [x] 5.7 Mark the drawer's item list with `data-lenis-prevent` so it scrolls natively without scrolling the page behind it

## 6. Cart drawer accessibility

- [x] 6.1 Move focus into the panel when the drawer opens
- [x] 6.2 Trap `Tab` focus within the open drawer so it never reaches page content behind it
- [x] 6.3 Restore focus to the control that opened the drawer when it closes
- [x] 6.4 Close the drawer on `Escape`, alongside the existing close control and backdrop click
- [ ] 6.5 Confirm a closed drawer is fully inert — invisible, non-interactive, and unreachable by keyboard

## 7. Final verification

- [ ] 7.1 Walk every scenario in `specs/storefront/smooth-scrolling/spec.md`
- [ ] 7.2 Walk every scenario in `specs/storefront/header-navigation/spec.md`
- [ ] 7.3 Walk every scenario in `specs/storefront/cart-drawer/spec.md`
- [ ] 7.4 Tune Lenis duration/easing on a real trackpad and a real touch device (design Open Questions)
- [x] 7.5 Run `npm run lint` and `npm run build` in `electrode-nextjs`
