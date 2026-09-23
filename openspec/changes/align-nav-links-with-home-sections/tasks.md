## 1. Storefront: the rule

- [x] 1.1 Add `nextjs/src/lib/nav-sections.ts` with the governed-route map (`/blogs`→`BLOG`, `/deals`→`DEAL_OF_WEEK`, `/products?sort=new`→`NEW_ARRIVALS`, `/products?sort=best`→`BEST_SELLING`) typed against `HomeSectionKey`, plus `isNavHrefVisible(href, homeConfig)`. Verify by type-check: a typo'd section key must fail to compile.
- [x] 1.2 Write the module's header comment per the repo's convention — why exact whole-string matching rather than the path-stripping `isHrefOffered` next door (design.md Decision 2), why this is a separate module from `catalog-features.ts` (Decision 1), and the obligation to keep the map in step with the admin's mirror and with `link-target-input.tsx`'s `STOREFRONT_ROUTES` (Decision 3). Verify by reading it back against those three decisions.
- [x] 1.3 Implement `filterNavForSections(items, homeConfig)` with the parent-survival rule from design.md Decision 4: drop a governed-and-disabled item; filter children on the same rule; drop a parent only when it has no surviving children AND its own target is either governed-and-disabled or empty. Verify with the unit tests in 1.4.
- [x] 1.4 Add `nextjs/src/lib/nav-sections.test.ts` covering every scenario in the spec's first three requirements plus the dropdown requirement: governed hidden, governed enabled, ungoverned always shown, `/blogs/how-we-source-our-coffee` and `/products?sort=newest` and `/blogs/` all unaffected, one-child-of-several dropped, parent-survives-children, parent-dropped-with-last-child, and an all-enabled config hiding nothing. Verify with `npm run test --workspace nextjs -- src/lib/nav-sections.test.ts`.
- [x] 1.5 Add a test asserting every section key in the map exists in the storefront's home-section key set, so a renamed or removed section cannot leave a dangling mapping (design.md Risks). Verify it fails when a key in the map is edited to a non-existent one.

## 2. Storefront: applying it

- [x] 2.1 In `nextjs/src/components/layout/Header.tsx`, compose `filterNavForSections` with the existing `filterNavForFeatures` inside the existing `useMemo` at line 112, adding `settings.homeConfig` to its dependency array. Verify `MobileMenuDrawer` still receives the same filtered `mainNav` (Header.tsx:750) so both surfaces agree without a second call.
- [x] 2.2 Extend the `useMemo`'s surrounding comment to state that the mobile drawer inherits this filtering by construction, not by coincidence — so a future refactor that passes `settings.mainNav` directly to the drawer is visibly wrong. Verify by reading it back.
- [ ] 2.3 Manually verify in the running storefront: with `BLOG` disabled, a `/blogs` nav item is absent from both the desktop header row and the mobile drawer, `/blogs` still loads directly, and the header's fixed "Today's Offers" control still renders (spec: "A fixed header control is unaffected"). Re-enable `BLOG` and confirm the link returns in its stored position.

## 3. Admin: the mirrored map

- [x] 3.1 Mirror the route map into `admin/src/lib/api/store-settings.ts` beside `HOME_SECTION_REGISTRY`, typed against the admin's `HomeSectionKey`, with a comment stating it mirrors the storefront's copy and that drift makes a notice wrong-but-visible rather than destructive (design.md Decision 3). Verify the admin build type-checks.
- [x] 3.2 Export a helper resolving a stored `href` to its governing section entry (key plus the registry's merchant-facing label), so both editors render the same words for the same section. Verify both call sites in sections 4 and 5 use it rather than duplicating the lookup.

## 4. Admin: Header Links notices

- [x] 4.1 In `header-links-page.tsx`, derive each row's suppression from the **saved** `data.homeConfig` — not the draft, since this page does not own that field. Verify the PATCH payload is unchanged: still exactly `mainNav` and `announcementBar` (partial-PATCH disjointness, design.md Decision 6).
- [x] 4.2 Render a notice on each suppressed top-level row and dropdown child: that it is hidden on the storefront, naming the responsible section in the registry's own label, with a link through to `/ui/home-sections`. Verify it renders for a `/blogs` row with `BLOG` off and is absent when `BLOG` is on.
- [x] 4.3 Confirm the notice is informational only — the row stays editable, is not greyed out, is not reordered, and saving stores exactly what was entered (spec: "A suppressed row is still editable"). Verify by editing and saving a suppressed row.
- [x] 4.4 Verify the notice is visually distinct from the page's existing `rowErrors` treatment: a suppression is not a validation failure and must not read as one, nor block saving.

## 5. Admin: Home Sections notices

- [x] 5.1 In `home-sections-page.tsx`, derive from the **live draft** section state and the saved `mainNav` which links each disabled section is currently suppressing (design.md Decision 6). Verify toggling a section off updates the notice immediately, before any save.
- [x] 5.2 Render on each such disabled section row the header links it is hiding, named by their stored labels. Verify a section with no matching nav link shows no notice, and that the PATCH payload still carries exactly `homeConfig` and `newsletter`.
- [x] 5.3 Verify the notice coexists with the existing "Your home page will be empty" warning without the two stacking into noise when every section is off.

## 6. Cross-checks and documentation

- [x] 6.1 Verify both admin editors still save independently: save Header Links, then Home Sections, then reload and confirm neither clobbered the other's fields.
- [x] 6.2 Verify a degraded settings read hides nothing — with the storefront falling back to `FALLBACK_SETTINGS`, every section is enabled and every nav link renders (spec: "A shop that has configured nothing hides nothing").
- [x] 6.3 Run `npm run test --workspace nextjs` and `npm run test --workspace admin`, and the admin build (which type-checks), reporting any failures rather than working around them.
- [x] 6.4 Record the coupling where the next person will hit it: a line in `link-target-input.tsx` noting that adding a route to `STOREFRONT_ROUTES` does not govern it, and a pointer from the `HOME_SECTION_KEYS` mirroring comment in `server/src/app/module/store-setting/store-setting.constant.ts` to this change folder. Verify both read correctly against design.md Decision 3.
