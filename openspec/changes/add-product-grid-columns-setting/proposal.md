## Why

Every product grid that spans the full content width shows **six cards across** on a large screen, hardcoded. A merchant whose products read better large — a phone with its screen showing, a laptop whose ports matter — cannot ask for fewer, bigger cards. Fewer columns at today's card size would only widen the gaps between them, so the column count and the card width have to move together. Changing it today means editing storefront code, which is the class of change `StoreSetting` exists to eliminate.

## What Changes

- **A merchant setting for how many product cards sit across a large-screen row: 4, 5 or 6.** Default **6**, which is what every grid renders today, so a store that never opens the control sees no change.
- **The card grows to fill the row.** The grid's columns stay equal shares of the content width, so four columns means each card is roughly half again as wide as at six — the gap between cards stays the same, not the card size.
- **It applies to the full-width product grids:** the three homepage product rows (Best Selling, Featured, New Arrivals) in both their grid and slider layouts, their loading skeletons, and "You may also like" on the product page.
- **Phones and tablets are unchanged.** Below the large breakpoint the grids stay two and three across; the setting governs the large-screen count only.
- **Rows stay full.** The number of products a homepage row requests and the number of related products follow the column count, so a five-across row never ends in a lone card on its own line.
- **Card images are requested at the size they are shown**, so a wider card is not a blurred upscale of an image sized for six across.
- The field rides `catalogConfig`, the block that already carries the other listing-presentation settings, so it reaches the storefront in the settings payload it already fetches on every page. **No migration** — `catalogConfig` is an existing JSON column.
- The admin's **Catalog settings** page gains the control.
- The Postman collection's `catalogConfig` examples are brought up to the full key set, including the new field.

Stated because their absence is deliberate:

- **Not `/products`, `/deals`, wishlist or compare.** Those listings are already four across (the catalogue page beside a filter sidebar). Six, five or four across beside a sidebar is a different layout question, not this one.
- **Not Deal of the Week.** Its five-across grid shares the row with a countdown panel.
- **Not per section.** One setting for the whole shop; cards of different widths in adjacent homepage rows would read as a mistake rather than as a choice.
- **No values outside 4–6.** Three across makes a homepage row a wall of one product at a time; seven or more makes the card too narrow for its price and add-to-cart action.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `api/site-settings`: `catalogConfig` gains the product-grid column count — validated on write to a closed set, published on the public settings payload, and defaulting to six. Same capability `add-catalog-display-settings` and `add-product-slider-and-card-quantity` added their `catalogConfig` requirements under; both are still unarchived, so this is an ADDED requirement beside them.
- `storefront/product-catalog`: the full-width product grids render the merchant's column count on a large screen, with cards that widen to fill the row and rows that stay full. ADDED beside the card requirements `add-product-slider-and-card-quantity` wrote under this capability.

## Impact

- **server** — `store-setting.constant.ts` (`DEFAULT_CATALOG_CONFIG` gains the field and a `PRODUCT_GRID_COLUMNS` tuple), `store-setting.validation.ts` (`catalogConfigSchema`), the `StoreSetting.prisma` doc comment, and the Postman collection. No service change: `catalogConfig` is already read with a per-key spread, so a stored row without the key reads at the default. No migration.
- **frontend** — `types/store-settings.ts`, `services/store-settings.ts` (`FALLBACK_SETTINGS`), `lib/catalog-features.ts`; a new grid-columns module holding the literal class strings and per-count figures; `ProductSection`, `ProductSlider`, `HomeSkeletons`, `ProductDetail`'s related grid, `ProductCard`'s image `sizes`, the homepage's `SECTION_SIZE` and the product page's related-products count.
- **admin** — `lib/api/store-settings.ts` (type, default, options) and `features/ui/catalog-settings/catalog-settings-page.tsx`.
- **Three repos mirror one value set by hand**, as they already do for the other `catalogConfig` keys.
- **Ships server-first, then admin in the same deploy.** `catalogConfigSchema` requires every key on write, so an admin build that predates the field is refused when it saves the Catalog settings page — the same window `openCartOnAdd` and `cardQuantityControl` opened.
