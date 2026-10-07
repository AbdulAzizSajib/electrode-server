## 1. Frame tokens

- [ ] 1.1 Add `--admin-bottom-nav-height: 4rem` to `admin/src/index.css` with a comment naming the three readers (bar, `<main>` padding, settings save bar) (design.md Decision 3), and add `viewport-fit=cover` to the viewport meta in `admin/index.html`. Verify `npm run build --workspace admin` succeeds (run by the user).

## 2. Bottom navigation

- [x] 2.1 In `admin/src/routes/nav-config.ts`, add `MOBILE_NAV_ITEMS` (Home `/dashboard`, Orders `/sales/orders`, Products `/catalog/products`, Inventory `/inventory/stock`) and a `getVisibleMobileNavItems(role)` that filters with `isNavNodeVisible`, plus an `isInventoryPath(pathname)` helper derived from the `Inventory` section's item paths (Decision 4). Verify with task 2.3.
- [ ] 2.2 Create `admin/src/components/layout/mobile-bottom-nav.tsx`: `lg:hidden`, fixed to the bottom, height from `--admin-bottom-nav-height`, padding-bottom `env(safe-area-inset-bottom)`, five items with icon and label, current-item highlight per Decision 4, the Orders badge from `usePulseValue()?.pendingOrderCount` capped at `99+`, and More calling `setMobileNavOpen(true)` and marked current when no other item matches. Verify with task 2.3 and visually at 390px.
- [x] 2.3 Add `mobile-bottom-nav.test.tsx` covering: five items in order; Orders badge shown above zero, hidden at zero, `99+` above 99; Inventory current on `/sales/returns`; More current on an uncovered path such as `/seo/general`; More opens the drawer. Verify `npm run test --workspace admin -- src/components/layout/mobile-bottom-nav.test.tsx` passes.

## 3. Shell scrolling

- [ ] 3.1 In `shell-layout.tsx`, make the shell `lg:fixed lg:inset-0 lg:overflow-hidden`, make `<main>` scroll only from `lg` with a phone bottom padding of `calc(var(--admin-bottom-nav-height) + env(safe-area-inset-bottom) + 1rem)`, scope the `html { overflow: hidden }` effect to `(min-width: 1024px)` with a media-query listener, mount `<MobileBottomNav />`, and rewrite the header comment to describe the split (Decision 2). Verify at 390px that the document scrolls and the last row of a long list sits above the bar, and at 1280px that the shell behaves as before.
- [ ] 3.2 In `shell-layout.tsx`, reset scroll on `location.pathname` change: window below `lg`, `mainScrollRef` from `lg` (Decision 8). Verify that opening an order from far down the orders list shows it from the top on both widths, and that changing a list's page or filter does not jump.
- [ ] 3.3 In `topbar.tsx`, remove the `lg:hidden` hamburger and make the header `sticky top-0 z-30` below `lg` (Decision 5). Verify at 390px that the top bar stays visible while scrolling and the desktop sidebar toggle is unchanged.
- [ ] 3.4 In `features/ui/components/settings-editor.tsx`, offset the sticky save bar to `bottom-[calc(var(--admin-bottom-nav-height)+env(safe-area-inset-bottom))] lg:bottom-0`. Verify on a settings page at 390px that the save bar is fully visible above the bottom bar.

## 4. Touch sizing

- [ ] 4.1 In `admin/src/components/ui/button.tsx`, add `pointer-coarse:` sizes: default and `lg` `min-h-[44px]`, `sm` `min-h-[40px]`, `icon` `size-[44px]` (Decision 6). Verify in Chrome DevTools with touch emulation that buttons measure at least those sizes and with a mouse are unchanged.
- [ ] 4.2 Add `pointer-coarse:min-h-[44px] pointer-coarse:text-[16px]` to `input.tsx`, `textarea.tsx`, the `SelectTrigger` in `select.tsx`, and the triggers and search inputs in `combobox.tsx` and `multi-select.tsx`. Verify on iOS Safari (or a device simulator) that focusing a field does not zoom the page.
- [x] 4.3 Run `npm run test --workspace admin` and fix any test broken by these class changes (not the three product-form/variant-editor failures that predate this change). Verify the suite has no new failures.

## 5. Hover-only actions

- [ ] 5.1 Add `pointer-coarse:opacity-100` to the action groups in `features/catalog/categories/category-tree-node.tsx:77` and `features/ui/home-slider/home-slider-page.tsx:702`, keeping the hover and focus reveal (Decision 7). Verify with touch emulation that the actions are visible, and with a mouse that they still appear on hover.

## 6. Wrap-up

- [ ] 6.1 Run `npm run lint --workspace admin` and ask the user to run `npm run build --workspace admin` and check on a real phone: bottom bar, More, the Orders badge, document scroll with the browser bar collapsing, no zoom on field focus, category actions visible. Verify every item behaves as specified.
