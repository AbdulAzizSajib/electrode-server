## Context

The shell today (`admin/src/components/layout/shell-layout.tsx`):

- A `fixed inset-0` box that is the viewport, with `<main>` as its only scroll region, and an effect that sets `html { overflow: hidden }` while mounted. The header comment explains why: on desktop, a document scrollbar beside `<main>`'s let the whole shell slide off-screen.
- Sidebar `hidden … lg:flex`; below `lg` a left `Sheet` drawer renders the full `SidebarNav`, opened by the top-bar hamburger through `useUiStore.setMobileNavOpen`.
- `mainScrollRef` exists only for the auto-hiding scrollbar. Nothing resets scroll on navigation, so `<main>` keeps the previous page's position.
- The pending-orders count comes from `usePulseValue()?.pendingOrderCount` (`sidebar-nav.tsx:50`).
- The one sticky footer in the panel is the settings editors' save bar, `sticky bottom-0` (`features/ui/components/settings-editor.tsx:288`).

Sizing tokens (`admin/src/index.css`): `--spacing: 0.22rem` (one step = 3.52px), `--text-sm: 15px`. Tailwind 4 ships a `pointer-coarse:` variant (`@media (pointer: coarse)`).

Home (`/dashboard`), Orders (`/sales/orders`), Products (`/catalog/products`) and the Inventory section carry no `roles` in `nav-config.ts`, so all four are visible to every role today.

## Goals / Non-Goals

**Goals:**
- Phone frame changes that every page inherits without being edited.
- The desktop shell left exactly as it is.

**Non-Goals:**
- Per-page layout work (lists as cards, the order page, form save bars, dialogs). Those are later steps on top of this frame.
- Changing the global spacing or type scale. That would resize the desktop panel too.
- Checkbox, switch and pager tap-target growth. They sit inside dense tables, which step 2 replaces with cards on phones; growing them now would only make those tables wider.

## Decisions

### 1. The split is at `lg`, the sidebar's own breakpoint

The bottom bar is `lg:hidden` and the document-scroll mode applies below `lg`. These are exactly the widths where the sidebar is hidden today. Tablets in portrait therefore get the phone frame, which is right: they have no sidebar either.

### 2. Document scroll below `lg`, the fixed shell from `lg`

- The shell's classes become `lg:fixed lg:inset-0 lg:overflow-hidden`.
- `<main>` becomes `lg:min-h-0 lg:flex-1 lg:overflow-y-auto`.
- The `html { overflow: hidden }` effect applies only while `(min-width: 1024px)` matches. It listens to the media query, so rotating or resizing across `lg` switches modes cleanly.

Below `lg`, the document scrolls and the browser may collapse its own bars. The top bar becomes `sticky top-0 z-30` with its existing surface background, so it stays put.

*Alternative considered:* keep `<main>` as the scroller on phones too. Rejected, because a nested scroller is precisely what stops mobile browsers collapsing their chrome, which is the main space win here. The desktop reasoning in the header comment does not apply below `lg`, because there is no sidebar to slide away. The comment is updated to state the split.

### 3. One height token for the bottom bar

`--admin-bottom-nav-height: 4rem` in `index.css` is read by three things:
- the bar itself;
- `<main>`'s bottom padding below `lg`: `calc(var(--admin-bottom-nav-height) + env(safe-area-inset-bottom) + 1rem)`;
- the settings editor's sticky bar: `bottom-[calc(var(--admin-bottom-nav-height)+env(safe-area-inset-bottom))] lg:bottom-0`.

A plain `rem` value avoids the panel's non-standard `--spacing`, so the number means what it says. The storefront hit the bug this prevents: its bar's height was changed in one place and the room reserved for it in another, and the footer ended up behind the bar.

`viewport-fit=cover` is added to `index.html`. Without it iOS reports `env(safe-area-inset-bottom)` as 0, and the bar would sit under the home indicator.

### 4. The bar's items are declared in `nav-config.ts` and role-filtered there

`MOBILE_NAV_ITEMS` sits beside `NAV_SECTIONS` and is filtered with the existing `isNavNodeVisible`. All four destinations are visible to every role today, so the filter changes nothing now. It keeps the bar honest if `roles` is ever added to one of them, and that is easy to forget because the sidebar and router are already kept in step by hand (CLAUDE.md, "Routes must be registered in two places").

Current-item matching:
- **Home, Orders, Products:** path prefix.
- **Inventory:** any path listed under the `Inventory` section in `NAV_SECTIONS`. This is derived, not restated, so moving a screen into or out of that section moves its highlight too.
- **More:** current when none of the four match.

Inventory taps through to `/inventory/stock`, the section's working screen.

### 5. More opens the existing drawer; the hamburger goes

More calls `setMobileNavOpen(true)`, the same store action the hamburger used, so the drawer, its role filtering and its close-on-navigate are reused as they are. The hamburger is removed below `lg`, because two controls opening one drawer is redundant, and the top bar needs the room for breadcrumbs, sound, bell and avatar. The desktop sidebar toggle is unaffected.

### 6. Touch sizing through `pointer-coarse:`, not breakpoints

Tap size is about the finger, not the width. A narrow desktop window does not need 44px buttons, and a tablet in landscape does. So the shared primitives gain `pointer-coarse:` classes:
- **Buttons:** default and `lg` get `min-h-[44px]`, `sm` gets `min-h-[40px]`, `icon` gets `size-[44px]`.
- **Inputs, textareas, select triggers, combobox and multi-select triggers:** `min-h-[44px]` and `text-[16px]`.

Pixel values rather than spacing steps, for the same reason as Decision 3. `min-h` rather than `h` where content can wrap.

`tailwind-merge` keeps variant classes apart from base ones, so a caller's `className="size-7"` on an icon button does **not** cancel `pointer-coarse:size-[44px]`. Every icon button grows on touch, including the ⋯ in table rows. That is intended: those are the controls that were too small. It makes dense tables taller on touch, which is acceptable because step 2 replaces those tables on phones.

`16px` is the iOS Safari threshold: a focused field with a smaller computed font size zooms the page. The panel's `text-base` is 17px here, so `text-[16px]` is the smallest value that stops the zoom.

### 7. Hover-revealed actions: always visible on touch

`category-tree-node.tsx:77` and `home-slider-page.tsx:702` gain `pointer-coarse:opacity-100`. They keep `group-hover:` and `focus-within:` for mouse and keyboard. The rule is stated in the spec ("no action is tappable while invisible") so a future hover-reveal is checked against it.

### 8. Scroll to top on navigation, both layouts

The shell resets scroll whenever `location.pathname` changes: `window.scrollTo(0, 0)` below `lg` and `mainScrollRef.current.scrollTo(0, 0)` from `lg`. It keys on the pathname only, so filter and pagination changes in the query string keep their place.

This is a small change on desktop, where `<main>` currently keeps its position across pages. It is included because the phone side needs it, and leaving the two layouts different would be a surprise.

## Risks / Trade-offs

- **Sticky elements that assumed `<main>` was the scroller.** Only `purchase-order-form-page.tsx:1463` (`xl:sticky xl:top-4`, desktop-only) and the settings save bar exist. The first never applies below `lg`; the second is handled by Decision 3.
- **Dense tables grow taller on touch** → accepted (Decision 6); superseded on phones by step 2.
- **Pages relying on `scrollIntoView` (form error focus)** → works with either scroller, since the browser scrolls whichever ancestor scrolls. The resource form's comment about content landing under the sticky header now also applies below `lg`, where the top bar is sticky; its `block: 'center'` already avoids that.
- **A desktop with a touch screen as primary pointer** gets the larger controls → correct for that device.

## Migration Plan

Admin-only; deploys on its own. Rollback is a revert. No data, no API change.
