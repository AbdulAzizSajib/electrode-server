## Why

"Track Order" currently lives in the announcement bar — the thin strip at the very top of the header, alongside the shop's phone number and email address. That strip is for contact details and a promotional message; it is the smallest, lowest-contrast row on the page, it is hidden entirely below `md`, and it disappears the moment a merchant switches the announcement bar off.

Track Order is not a contact detail. It is a primary shopper action, in the same class as Cart, Wishlist and Account — the things a returning customer comes back to do. It belongs in the main header row beside them, where there is already a visible gap to its left of the cart.

The deeper problem is that the main row has **no merchant-configurable slot at all**. Wishlist, Compare, Cart and Account are hardcoded components, so today the only place a merchant can put a link like this is the announcement bar, whether or not it belongs there. Moving one link by hardcoding a second button would leave that limitation exactly where it is.

## What Changes

- **A new `middleBarLinks` setting**: an ordered list of `{ icon?, label, href }` entries rendered in the header's main row, to the left of the cart, styled as the existing icon-plus-label actions are.
- **A new "Middle bar links" section on the Header Links page**, between Announcement bar and Main navigation, editing that list with the same row controls (add, reorder, remove, target picker) the announcement links already use.
- **A one-time data migration** moves an existing `/track-order` entry out of `announcementBar.links` and into `middleBarLinks`, preserving its label and icon. A shop that has one keeps exactly one, in its new place, with nothing to do by hand.
- **The storefront fallback moves too**: `FALLBACK_SETTINGS` stops listing Track Order under the announcement bar and lists it under the new key, so a settings outage degrades to the new layout rather than the old one.
- **Capacity is 4 links**, below the announcement bar's 6. This row already holds up to four hardcoded actions plus the search box and the brand, and it is the row that runs out of horizontal space first.
- **Desktop only**, matching the actions it sits among. The mobile bottom nav and the mobile drawer already carry the primary actions on small screens, and this row's action group is `hidden md:flex` today.

Not a rename or a move of the `announcementBar` shape — that setting keeps its links, its `source` binding and its capacity. This adds a second, independent list.

## Capabilities

### New Capabilities

- `storefront/header-middle-bar-links`: A merchant-configurable list of link actions in the storefront header's main row — what it holds, where it renders, how it is bounded, and how the existing Track Order entry migrates into it.

### Modified Capabilities

None. The announcement bar, the main navigation and the header's hardcoded actions each keep their current contract; the only change to the announcement bar is to the *data* one shop row happens to hold, not to what the setting may contain.

## Impact

**Server (`server/`)**
- `prisma/schema/StoreSetting.prisma` — one new `Json?` column, `middleBarLinks`, documented in the `///` block beside `mainNav` and `announcementBar`.
- A migration adding the column **and** performing the one-time move. Per the repo's standing hazard, the generated SQL must have its `DROP INDEX` lines removed and the NOTE block carried forward.
- `store-setting.validation.ts` — a `middleBarLinksSchema`, `.optional()` only (an omitted key means "leave unchanged"; the empty array is how a merchant clears the row). Json columns are unconstrained by Postgres, so this schema is the only gate.
- `store-setting.constant.ts` / `store-setting.service.ts` — the default value and its inclusion in the settings read.
- Fires the existing `store-settings` revalidate tag on write, as the other header fields already do.

**Storefront (`nextjs/`)**
- `types/store-settings.ts` and `services/store-settings.ts` — the new field, its mapper, and the `FALLBACK_SETTINGS` move.
- `components/layout/Header.tsx` — renders the list in the main row's action group.

**Admin (`admin/`)**
- `lib/api/store-settings.ts` — the type, the `SETTINGS_LIMITS` entry, and a `DEFAULT_MIDDLE_BAR_LINKS` mirror.
- `features/ui/header-links/header-links-page.tsx` — the new editor section. It already writes `mainNav` and `announcementBar`; this adds a third key to that same disjoint set, so partial-PATCH discipline is preserved by construction.

**Interaction with `align-nav-links-with-home-sections`**: that change governs `mainNav` only. `/track-order` is not a governed target and no home section fills it, so nothing here is suppressed by a disabled section — and the middle bar is deliberately outside that rule's scope.
