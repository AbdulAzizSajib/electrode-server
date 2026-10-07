## Why

Most merchants run their shop from a phone, and the admin panel was built for a desk. A phone audit (360–414px) found the panel usable but uncomfortable in ways that touch every page:

- **Getting anywhere costs three taps on a 28px button.** Below `lg` the sidebar is hidden and the only navigation is a hamburger drawer (`topbar.tsx:211-219`, `size="icon"` = 28px). The pending-orders badge lives inside that drawer (`sidebar-nav.tsx:50,68`), so a new order is invisible until the drawer is opened.
- **The page never scrolls, so the browser's address bar never collapses.** The shell is `fixed inset-0` with `<main>` as the only scroller and `html { overflow: hidden }` (`shell-layout.tsx:69-76,96`). On a phone that permanently spends 50–100px of a small screen on browser chrome.
- **Nearly every control is too small for a finger.** The panel's spacing step is 0.22rem rather than 0.25rem (`index.css:39`), so the default button is 28px, the icon button 28px, `sm` 25px, inputs 35px — against the ~44px a thumb needs.
- **Every text field zooms the page on iOS.** Inputs, textareas, selects and both comboboxes use `text-sm`, which is 15px here (`index.css:33`); iOS Safari zooms on focusing anything under 16px.
- **Two pages hide destructive actions behind hover.** The Categories tree (`category-tree-node.tsx:77`) and the Home Slider slots (`home-slider-page.tsx:702`) are `opacity-0 group-hover:opacity-100`. On a touch screen they are invisible but still tappable — a tap near the right edge of a category row can land on an unseen Delete.

This is step 1 of making the panel phone-first: the frame every page sits in. Lists as cards, the order-processing page, form save bars and dialog sizing are later steps that build on it.

## What Changes

- **New mobile bottom navigation bar** below `lg`: Home, Orders (with the pending-orders badge), Products, Inventory, and **More**, which opens the full menu drawer. Items respect the same role rules as the sidebar.
- **The top-bar hamburger is removed** below `lg` — More does the same job from where the thumb already is, and the top bar gets the room back.
- **The page scrolls as a normal document below `lg`**, so mobile browser chrome collapses on scroll. The top bar stays pinned; content reserves room for the bottom bar and the device's safe area. **From `lg` up the shell is unchanged** — fixed, with `<main>` as the scroller.
- **Navigating to another page starts it at the top**, on both layouts. Today `<main>` keeps the previous page's scroll position across navigation; with document scroll on phones the same would happen to the window.
- **Touch-sized controls on touch screens.** On a coarse pointer (phones and tablets), shared buttons become at least 40–44px tall and icon buttons 44px square, and text fields become 44px tall with 16px text so iOS stops zooming on focus. Mouse users see no change.
- **Hover-only row actions are always visible on touch screens** on the Categories tree and Home Slider slots.
- **The settings editors' sticky save bar sits above the bottom bar** on phones instead of behind it.
- `index.html` gains `viewport-fit=cover` so the safe-area inset is reported on notched iPhones.

Out of scope (later steps): card layouts for lists, the order detail and dispatch flow, sticky save bars on CRUD forms, dialog margins and scrolling, tap-target growth for checkboxes and switches.

## Capabilities

### New Capabilities
- `admin-shell`: requirements ADDED to the admin shell for phones and touch screens — the bottom navigation and what it contains, how the rest of the menu is reached, how the page scrolls, where content and sticky bars sit relative to the bottom bar, minimum touch sizes for shared controls, and that no action is reachable by touch while invisible.

  `admin-shell` was introduced by `admin/openspec/changes/build-admin-panel` and never archived into a main spec, so these arrive as ADDED requirements rather than a MODIFIED delta. One of its scenarios is **superseded**: "Responsive Layout — Narrow viewport collapses sidebar" says the menu "can be opened as an overlay via a menu toggle in the topbar". Below `lg` that toggle is replaced by the bottom bar's More item; the overlay itself is unchanged.

### Modified Capabilities
None that exist as a main spec (see the note above).

## Impact

**admin**
- `src/components/layout/shell-layout.tsx` — document scroll below `lg`, bottom bar mounted, scroll-to-top on navigation.
- New `src/components/layout/mobile-bottom-nav.tsx`.
- `src/components/layout/topbar.tsx` — hamburger removed, pinned on phones.
- `src/routes/nav-config.ts` — the bottom bar's items, declared beside `NAV_SECTIONS` and role-filtered with the same `isNavNodeVisible`.
- `src/components/ui/{button,input,textarea,select,combobox,multi-select}.tsx` — `pointer-coarse:` sizing.
- `src/features/catalog/categories/category-tree-node.tsx`, `src/features/ui/home-slider/home-slider-page.tsx` — actions visible on touch.
- `src/features/ui/components/settings-editor.tsx` — sticky bar offset.
- `src/index.css` — `--admin-bottom-nav-height` token; `index.html` — `viewport-fit=cover`.

**server, nextjs** — none.
