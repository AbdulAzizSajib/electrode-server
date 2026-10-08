## Why

A merchant can colour the page, the text, the brand, the accent and the sale price, but not the cards shoppers browse. Product cards are always white, category tiles always light grey (`bg-gray-50`), and testimonials always white, whatever palette the merchant chose. On a warm cream page (the Sweet Bites shop uses `#FFF9F2`), those fixed whites and greys read as pasted-on boxes from another site.

An audit of the storefront found the cause is general, not one component: **968 hard-coded Tailwind palette classes and 19 literal hex values** outside the landing pages, none reachable from the admin. This change makes the one surface the merchant asked for themeable. The full inventory is recorded in design.md so later changes can take on the rest deliberately rather than by rediscovery.

## What Changes

- **New theme colour "Card background"**, a seventh field in Site Setting → Colours, beside the existing six.
- **It colours the browsing cards together**: product cards, category tiles, brand tiles, testimonial cards and blog cards, on the home page and everywhere those cards appear.
- **Brand logos get a tile.** Today they sit directly on the page; each now sits on a rounded card in the card colour, matching the category tiles.
- **Blog cards become cards.** Today their text sits on the page background; they gain a card surface and padding so the colour has something to apply to.
- **Unset changes nothing that exists.** The colour is optional. Until the merchant picks one, product cards stay white and category tiles stay light grey, exactly as today. Once set, all of them follow it. Only the two new surfaces (brand tiles and blog cards) are visible changes for an unconfigured shop, and they take the product card's look: white with a light border.
- **A contrast check** joins the existing two under the colours: card text on the card colour, warning below 4.5:1, because card text is a fixed dark grey and a dark card colour would make it unreadable.
- **Backward compatible API.** The theme is written whole and validated strictly; the new key is optional, carried forward when a save omits it, cleared by `null`, and absent on read until set, the same carry-forward `adminFont` already gets. No existing caller of `PATCH /settings` breaks.

Out of scope, recorded in design.md's inventory for later changes:
- A second "panel" colour for cart, checkout and account cards.
- Themeable text greys, borders, and state colours (green savings, red errors, amber stock).
- White text on brand buttons (no "on-brand" contrast colour exists).
- The Deal of the Week section's fixed blue gradient, which ignores the brand.
- The discount badge being `bg-sale` on product cards but `bg-brand` on product detail and quick view.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `storefront-cms/theming`: the palette gains an optional seventh colour for browsing cards, with its own unset behaviour and contrast guidance. That capability was introduced by `add-checkout-and-site-settings` and never archived into a main spec, so the requirement arrives as ADDED; its existing "six presentation colours" wording becomes seven once this lands.

## Impact

**server**
- `store-setting.validation.ts`: `themeSchema` gains `cardBackground: hexColorSchema.nullable().optional()`: omitted keeps it, a hex sets it, `null` returns it to the default.
- `store-setting.service.ts`: carries a stored `cardBackground` forward when a theme save omits it.
- `store-setting.constant.ts`: no default (unset is a real state).
- `StoreSetting.prisma`: the `theme` Json field's doc comment lists the new key. **No migration**; the theme is a Json column.

**admin**
- `lib/api/store-settings.ts`: `Theme.cardBackground?: string | null`.
- `features/ui/site-settings/site-settings-page.tsx`: an optional colour picker with a "Use default" state, and the new contrast note.

**nextjs**
- `types/store-settings.ts`, `lib/theme.ts` (writes `--color-card` only when set), `app/globals.css` (no `:root` default, on purpose).
- `ProductCard.tsx`, `Skeleton.tsx` (card skeleton), `CategoryTile.tsx`, `HomeSkeletons.tsx` (tile skeletons), `BrandBar.tsx`, `Testimonials.tsx`, `BlogSection.tsx`, `app/(shop)/blogs/page.tsx`.
