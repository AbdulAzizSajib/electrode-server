## Why

A merchant who switches off a home section — say **Recent blog posts** — still has a **Blog** link sitting in the storefront header, because the header's navigation and the homepage's section list are two unrelated settings that nothing reconciles. The merchant edits Home Sections, looks at their site, sees the link still there, and reasonably concludes the switch did not work.

It is worse than a cosmetic mismatch when the section was the only thing populating that destination: a shop that disables **Deal of the week** because it is running no deals still advertises **Today's Offers** in its header, and a shopper who follows it lands on a page with nothing on it. The two screens are `/ui/home-sections` and `/ui/header-links` in the admin, and today nothing on either screen even mentions the other.

## What Changes

- The storefront **hides a header navigation link whose destination is governed by a disabled home section**. `mainNav` is unchanged on the server — the merchant's stored link is kept exactly as saved and reappears the moment the section is switched back on.
- Which destinations are governed is a **fixed, closed map** from a known storefront route to a home section key (`/blogs` → `BLOG`, `/deals` → `DEAL_OF_WEEK`, `/products?sort=new` → `NEW_ARRIVALS`, `/products?sort=best` → `BEST_SELLING`). It covers only routes the admin's own target picker offers. An unmatched target — a custom path, a CMS page, an external URL — is **never** hidden.
- The rule applies to the **desktop header row and the mobile menu drawer**, which render the same `mainNav` data and must not disagree. Footer links, the announcement bar and the header's hardcoded controls are out of scope.
- Matching is **exact, not prefix-based**: `/blogs` is governed, `/blogs/how-we-source` is a link the merchant wrote deliberately and is left alone.
- **Dropdown children follow the same rule** as top-level items. A parent whose every child is hidden and whose own target is also governed-and-disabled is hidden with them.
- The admin's **Header Links** page marks each affected row: *"Hidden on your site — the Recent blog posts section is off"*, with a link through to Home Sections. The row remains fully editable; nothing is disabled or removed.
- The admin's **Home Sections** page names, on a disabled section's row, the header links that section is currently suppressing — so the consequence is visible from the screen where the decision is made.
- There is **no per-link override**. The rule is one rule with no exceptions, so what a merchant sees in the admin is always what the storefront does.

No API shape changes, no schema changes, no migration. This is a render-time rule plus two admin affordances.

## Capabilities

### New Capabilities

- `storefront/navigation-section-alignment`: How storefront navigation links and homepage section visibility are reconciled — which link targets are governed by which sections, when a link is suppressed, and how the admin reports that suppression to the merchant.

### Modified Capabilities

None.

`storefront-home-sections` carries a "Chrome is not addressable" requirement that reads as though the header is wholly unaffected by the homepage configuration, and this change narrows it. But that capability has **no main spec yet** — it exists only in the unarchived `add-homepage-section-toggles` change, so there is nothing under `openspec/specs/` to write a delta against. The boundary is therefore restated inside the new capability's spec (see "Chrome remains unaddressable"), which is where it will be read from. When `add-homepage-section-toggles` is archived, that requirement's wording should be reconciled against this one rather than left to contradict it.

## Impact

**Storefront (`nextjs/`)**
- New shared constant mapping governed routes to `HomeSectionKey`, alongside the existing home-section types.
- `src/components/layout/Header.tsx` and `src/components/layout/MobileMenuDrawer.tsx` filter `mainNav` before rendering. Both need `homeConfig`, which the `(shop)` layout already fetches as part of store settings — no new request.
- Filtering happens on already-fetched data, so there is no new failure mode: a settings payload that falls back to defaults has every section enabled and therefore hides nothing.

**Admin (`admin/`)**
- `src/features/ui/header-links/header-links-page.tsx` — a per-row notice, read from the already-loaded `homeConfig`.
- `src/features/ui/home-sections/home-sections-page.tsx` — a per-row notice on disabled sections, read from the already-loaded `mainNav`.
- A mirrored copy of the route→section map, carrying the existing obligation to be kept in step with the storefront's copy.

**Server (`server/`)**
- None. `mainNav` and `homeConfig` are stored and validated exactly as they are today; this change adds no coupling between them in the database or the API.

**Explicitly unaffected**: footer links, the announcement bar, the header's hardcoded `/deals` "Today's Offers" control and its wishlist/compare/cart actions, and every storefront route itself — `/blogs` keeps working when the `BLOG` section is off, it simply is not linked from the header.
