## Why

Three complaints about the same stretch of the shopping flow, from picking a product off the homepage to confirming what is being bought.

**The homepage's product rows are stuck in a grid.** `add-featured-categories-layout` gave the featured categories a slider and built the mechanism generically — `HOME_SECTION_VARIANTS` is a per-section registry, and the comment sitting in it already names the product rows as the next entrant, noting the cost is "one tuple and one entry… no schema change, no migration". The three product rows (`BEST_SELLING`, `FEATURED_PRODUCTS`, `NEW_ARRIVALS`) all render through one `ProductSection` component with a hardcoded grid. A merchant with six featured products and a wide screen gets a row; one with six on a phone gets three tall rows of scrolling. The choice exists for categories and not for the products beside them.

**Changing a quantity costs a round trip through the drawer.** Adding from a card sends `quantity: 1`, hardcoded, and then opens the cart drawer over the listing — so a shopper who wants three of something adds one, waits for the drawer, steps it to three in there, closes the drawer, and has lost their place in the listing. The drawer opening at all is the second half of the complaint: it is the correct response to a deliberate "show me my cart", and an interruption when it fires on every add.

**Checkout shows a quantity it will not let you change.** The order summary renders each line's quantity as a badge on its thumbnail. A shopper who reaches the final screen and sees two of something they wanted one of has to go back to the cart, fix it, and return — at the exact moment they were about to pay.

## What Changes

- **The three homepage product rows each offer a grid and a slider**, chosen per row on the Home Sections screen, exactly as the featured categories are. `GRID` stays the default and renders what those rows render today, so a shop that never opens the control sees no change.

- **A product card carries a quantity stepper once its product is in the cart.** Before that it carries the "Add to cart" action it carries today. The stepper edits the cart line, so the card and the cart never disagree, and it is present on a reload — a shopper returning to a listing sees what is already in their cart.

- **The cart drawer's auto-open after an add becomes a setting**, defaulting to on. Turned off, adding a product leaves the shopper where they are and the drawer opens only when they ask for it — the header cart button, the mobile nav, the floating rail. Those three paths are unaffected by the setting in either position.

- **Checkout's order summary gets the quantity stepper and a remove control** the cart page already has.

- **No new API.** `AddCartItemPayload` already carries `quantity`, and `PATCH /cart/items/:itemId` already sets one. This change sends what is already accepted.

Stated because their absence is deliberate:

- **No stepper on a card whose product is not yet in the cart.** `unify-card-add-to-cart-action` requires that "a shopper scanning a listing MUST NOT be able to tell from the action alone whether a product has variants", and a stepper offered only where a card can add directly would announce exactly that. Every card's resting state stays one identically-labelled action; the stepper is a post-add state that a variable product reaches too, through the quick view it already opens.

- **No slider on `/products`, `/deals`, related products, wishlist or compare.** The layout mechanism is a field of `homeConfig`, which governs the homepage and nothing else. Those surfaces would need a carrier of their own, and a listing with filters and pagination is not a row to be scrolled sideways.

- **No slider on `DEAL_OF_WEEK`.** Its products share a six-column grid with a countdown panel; a slider there is a different layout problem, not this one.

- **No stock ceiling added to the existing cart stepper.** It has never clamped to `line.stockQuantity` and checkout re-validates stock; changing that is a separate decision about where stock is enforced.

- **No change to how a variable product is added.** It still goes through the quick view or its detail page to choose a variant first.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `storefront-home-sections`: the three homepage product rows join the set of sections that offer a closed list of layouts, each offering `GRID` and `SLIDER`. Sits alongside the requirements `add-homepage-section-toggles` and `add-featured-categories-layout` add to this capability — both are still unarchived, so these are ADDED requirements rather than modifications of their text.
- `storefront/product-catalog`: a listing's product card gains a quantity control, shown once the product is in the cart, replacing that card's purchase action while it is there. MODIFIES the requirement `unify-card-add-to-cart-action` states about a listing's purchase action, which currently describes the resting state as the only state.
- `storefront/cart-drawer`: whether the drawer opens by itself after an add becomes a merchant setting; the paths by which a shopper opens it deliberately are unaffected. ADDED alongside that capability's existing animation, inertness and focus requirements.
- `api/site-settings`: `catalogConfig` gains the flag governing the drawer's auto-open, validated on write and published on the public settings payload like the three flags already there. This is the capability `add-catalog-display-settings` added `catalogConfig` under; that change is still unarchived, so this is an ADDED requirement sitting alongside its text.
- `storefront/checkout-summary`: the order summary presented before payment becomes editable — a line's quantity may be changed and a line removed, from the summary itself. A new sub-capability under the existing `storefront` capability, which is where storefront-facing behaviour is specified (`storefront/cart-drawer`, `storefront/product-catalog`); `api/checkout` governs what the backend does when an order is placed and is unchanged by this.

## Impact

- **server** — `store-setting.constant.ts` (a `PRODUCT_ROW_VARIANTS` tuple and three `HOME_SECTION_VARIANTS` entries; one field on `DEFAULT_CATALOG_CONFIG`), `store-setting.validation.ts` (the new `catalogConfig` key; `homeConfigSchema` needs no edit, being generic over the variants map). **No migration** — `variant` lives inside the existing `homeConfig` JSONB and the catalog flag inside the existing `catalogConfig` JSONB. `scripts/verify-section-variants.ts` iterates the variants map and covers the three new sections without being edited.
- **nextjs** — `lib/section-layouts.ts` and `types/store-settings.ts` (mirrors, same order); `services/store-settings.ts` (`FALLBACK_SETTINGS`, per-key repair); a product-row layout registry with a slider component and its skeleton; `(shop)/page.tsx` (resolve and pass three layouts); `ProductCard.tsx` (the stepper state); `CheckoutForm.tsx` (the summary's controls); `lib/catalog-features.ts` (the new flag); the four `openCart()` call sites that fire after an add.
- **admin** — `lib/api/store-settings.ts` (the layout union and options array), a product-row layout picker mounted on the Home Sections rows, and the catalog settings page for the drawer flag.
- **Three repos mirror one registry by hand.** A section that offers layouts is named in the backend's variants map, the storefront's `SECTION_LAYOUTS`, and the admin's options array, in the same order — the existing hazard this change enlarges from two sections to five.
- **Ships server-first.** The server accepting a layout no client sends is inert; an admin offering one the API refuses is a form that fails on save.
