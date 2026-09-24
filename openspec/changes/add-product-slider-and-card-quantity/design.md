## Context

See proposal.md — Why. Five things already in place decide most of this.

**The section-layout mechanism is already generic, and was built expecting this.** `HOME_SECTION_VARIANTS` in `store-setting.constant.ts` maps a section key to an ordered tuple of layouts, position 0 being the default. `homeConfigSchema`, `reconcileHomeConfig`, `resolveSectionVariant`, the public read and `scripts/verify-section-variants.ts` are all generic over that map — the comment above it records that `FEATURED_CATEGORIES` joining "cost exactly what this shape was built to make it cost: one tuple and one entry here, no schema change, no migration, and nothing in validation, reconciliation or the public read", and names the product rows as the next entrant. The storefront mirrors it in `lib/section-layouts.ts` and the admin in `lib/api/store-settings.ts`, in the same order, by hand.

**All three product rows already render through one component.** `(shop)/page.tsx` wires `BEST_SELLING`, `FEATURED_PRODUCTS` and `NEW_ARRIVALS` to `ProductRow` in `HomeSections.tsx`, which fetches, returns `null` when empty, and renders `ProductSection` — whose markup is a hardcoded `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`. One component is the grid layout for all three sections.

**The cart is server-side, and the whole page already subscribes to it.** Cart contents are RTK Query (`cartApi`, proxied through `/api/cart/*` because the backend's `guestToken` is httpOnly on its own domain); the drawer's open state is a separate Redux slice (`uiSlice`). `Header` and `CartRail` both call `useGetCartQuery()` unconditionally on every page, so the cart is already in the cache wherever a listing renders — a card reading it adds a subscriber, not a request.

**The cart's quantity stepper already exists and already solves the hard parts.** `components/cart/CartLineControls.tsx` is shared by the drawer and the cart page: local state moves on every click, a `confirmed` ref holds the last server-confirmed value, a 400 ms trailing debounce collapses a burst of clicks into one PATCH, buttons are deliberately never disabled mid-flight, an external change never stomps a pending edit, a failure reverts to `confirmed` and surfaces the message, and stepping below 1 removes the line. `updateItemQuantity` deliberately carries no RTK optimistic patch because this component owns the optimistic display and the revert.

**A binding constraint from an applied change.** `unify-card-add-to-cart-action` requires that "a shopper scanning a listing MUST NOT be able to tell from the action alone whether a product has variants". A card cannot add a variable product directly — the list endpoint omits `variants` — so it opens the quick view or links to the detail page instead. Any control added to the card has to survive that rule.

Also in force: `catalogConfig` is a JSON blob whose Zod schema is its only gate, written whole (all flags required) and repaired per-key on read; `lib/catalog-features.ts` is a module-scope singleton rather than a context, because both server and client components read it.

## Goals / Non-Goals

**Goals:**

- A merchant chooses a product row's arrangement with the control they already use for categories, and it costs the codebase what the mechanism was designed to cost.
- A shopper sets a quantity where they are looking, and the card never disagrees with the cart.
- The drawer stops interrupting, without taking away any way of opening it.
- Checkout's summary can be corrected at the moment the mistake is noticed.
- Nothing above reveals which products have variants.

**Non-Goals:**

- A second quantity-stepper implementation. There is one, and it is the one that gets reused.
- Changing how a variable product is added, or teaching the list endpoint about variants.
- A layout mechanism for any surface that is not a homepage section.
- Changing the cart's money derivation, its optimistic strategy, or where stock is enforced.

## Decisions

### 1. Three registry entries, not one shared setting

**Chosen:** `PRODUCT_ROW_VARIANTS = ["GRID", "SLIDER"]` declared once, then named three times in `HOME_SECTION_VARIANTS` — one entry per product row key.

The layout is stored as `variant` on a section's own entry in `homeConfig`, so per-section is what the carrier already expresses. A single switch governing all three rows would need a different carrier — a new `catalogConfig` flag, say — which would then be a second, differently-shaped way of saying the same kind of thing, and the admin would have one layout control on the Featured Categories row and another somewhere else entirely for the rows beside it.

Three entries also means a merchant can make the row with four products a grid and the row with twelve a slider, which is the actual reason to want this.

**Rejected:** one `HOME_SECTION_VARIANTS` entry covering all three. The map is keyed by section key; there is no "these three" key.

**Rejected:** a `catalogConfig.productRowLayout` global. Above.

### 2. The slider is a new component beside `ProductSection`, not a prop on it

**Chosen:** a registry `Record<ProductRowLayout, { Component, Skeleton }>` in the same shape as `components/home/categories/registry.ts`, with `ProductSection` becoming the `GRID` entry and a new `ProductSlider` the other.

Binding Component and Skeleton in one `Record` is what makes TypeScript report a missing skeleton the moment a layout is added — the categories registry states the reason: a placeholder shaped unlike the layout that replaces it causes a first-paint reflow.

`ProductSection` keeps its markup **byte-identical**, so a shop that never opens the control sees no change. That is the same guarantee `CategoryGridLayout` was given and for the same reason.

**Rejected:** a `layout` prop on `ProductSection` branching internally. It would put a client-side carousel's `"use client"` boundary around a component that is currently a server component rendering a static grid, for every shop including those using the grid.

### 3. The slider mirrors the category slider's constraints, not its column counts

**Chosen:** a `"use client"` Swiper row with `slidesPerView` matched to the grid's `2 / 3 / 6` breakpoints and the grid's gap, no autoplay, no loop, visible navigation.

The category slider already solved these: constants duplicated from the grid so a card is the same size in both layouts, arrows attached in `onBeforeInit` because Swiper reads nav elements at init before React attaches refs, and `!flex !h-auto` on the slide so cards share a height. The product row's column counts differ from the categories' (`2/3/6` against `3/4/7`), so the constants are new; the constraints are not.

No autoplay for the reason the categories give — these are navigation and merchandising, not a carousel demanding attention — and because a row that moves under the pointer makes the card's new quantity stepper hard to hit.

### 4. The card's control is derived from the cart, not from what the shopper just did

**Chosen:** a card looks up its product in the cart (`useGetCartQuery`, already subscribed page-wide) and renders the stepper when a line matches, the purchase action otherwise.

The alternative — a local "I added this" flag — is cheaper and wrong in a way the shopper notices: reload the page, or arrive at a listing with a cart filled yesterday, and the card offers "Add to cart" for something already in the cart. Adding again then silently doubles a quantity the shopper never saw. Deriving from the cart makes the card and the cart one fact.

It costs no request. `Header` and `CartRail` already hold an unconditional `useGetCartQuery()` subscription on every page, so the cache entry exists wherever a listing renders and a card joins it.

**Matching a line:** by `productId` **and** `variantId`, because two variants of one product are two lines. A card whose product has variants matches only a line carrying the variant that was added — so after adding Red from the quick view, that card steps Red. A card matching more than one line (two variants of the same product both in the cart) shows its purchase action rather than picking one arbitrarily; which line a stepper would govern is not answerable from a listing card, and guessing is worse than not offering.

### 5. The card reuses `CartLineControls`, which means extracting it

**Chosen:** the debounce, the `confirmed` ref, the never-disabled buttons, the revert-and-explain and the below-one removal move into a hook the existing `CartQuantityControl` and the card's control both use. The card's rendering differs (it fills the action slot, at the card's own size); the behaviour does not.

Writing a second stepper for the card would mean two implementations of "what happens when a shopper clicks + five times and one PATCH fails", and the existing one is the one with the bugs already taken out of it. The card is also the place most exposed to a burst of clicks, since it sits in a grid the shopper is scanning.

**Rejected:** rendering `CartQuantityControl` directly with a new `size`. It renders its own error paragraph and its own layout; a card's action slot is a fixed-height row and the drawer's is not.

### 5c. The card's quantity control is a setting, and it is the one flag that defaults OFF

**Chosen (added on the merchant's request, after the control was built):** a
`cardQuantityControl` boolean on `catalogConfig`, default **`false`**. Off, the
card is exactly what it was before this change: one "Add to cart" action,
whatever the cart holds.

Every other flag in that block defaults `true`, and the asymmetry is the whole
reason this one is worth stating. The rule those follow is not "default on" — it
is *"a new flag reproduces the behaviour that preceded it"*. `showWishlist`,
`showCompare`, `showQuickView` and `openCartOnAdd` each WITHDRAW something that
was already on the page, so reproducing the old behaviour means on. This one
ADDS a control that never existed, so the same rule lands on off. Defaulting it
true would have changed every existing shop's listing without anyone asking.

It fails off for the same reason: `FALLBACK_SETTINGS` and `FALLBACK_FEATURES`
both carry `false`, so a shop whose settings cannot be read shows the card it has
always shown rather than a control its merchant never switched on.

**Gated at the lookup, not at the render.** `ProductCard` skips
`cartLineForCard` entirely when the flag is off, so `cartLine` is `undefined`
and the existing branches — sold out, simple, quick view, detail link — are
reached exactly as they were. There is no second code path for "off"; off is the
original path.

**The `useGetCartQuery()` subscription still runs when off.** Skipping it would
save nothing, because `Header` and `CartRail` hold it unconditionally on every
page, and it would make the card's behaviour depend on which other components
happened to be mounted.

**Scope: the CARD only.** The drawer, the cart page and the checkout summary keep
their steppers unconditionally — changing a quantity is how a cart is edited, not
a feature to be switched off. The merchant's framing was that the card is the new
thing and should be optional; where a cart is already open, it is not new.

*Rejected:* one flag governing the card and the checkout summary together. They
answer different questions — whether a listing offers editing, versus whether a
cart can be corrected before paying — and a merchant who wants plain cards has no
reason to also want a checkout they cannot fix a mistake on.

### 6. The drawer flag lives on `catalogConfig`, and suppresses only the automatic open

**Chosen:** one boolean on `catalogConfig`, default `true`, read through `lib/catalog-features.ts`.

It is arguably a cart concern rather than a catalog-display one, and a `cartConfig` blob would be defensible. `catalogConfig` wins on two counts: `ProductCard` already reads that singleton, so the flag reaches the component that needs it with no new plumbing; and what the flag actually governs is what a *listing* does when you act on it, which is what the other three flags there govern too.

**The suppression is at the four call sites that fire after an add** — the card, the quick view, the detail page, and move-from-wishlist — not inside `openCart()`. Gating the reducer would also disable the header button, the mobile nav and the rail, which is the opposite of what the setting means. The three deliberate paths never consult the flag.

**Default `true`** because the repo's rule for a new flag is that it reproduces the behaviour that preceded it, and because the failure direction matters: with settings unreadable, `FALLBACK_SETTINGS` supplies `true`, so a shopper is never left with no indication their cart changed.

**Consequence:** with the drawer suppressed, the card's "Added ✓" feedback stops being decoration and becomes the only confirmation an add happened. It already exists (`justAdded`, 1600 ms) and is kept.

### 7. Checkout reuses the cart page's controls, and renews the idempotency key

**Chosen:** `CheckoutForm`'s inline summary renders `CartQuantityControl` and `CartRemoveButton`, the same two the cart page uses.

`orderFingerprint` already includes each line's id and quantity, and an effect already regenerates `idempotencyKey` whenever that fingerprint changes — so a quantity edit on checkout invalidates the in-flight key for free, which is the correct behaviour and needs no new code. This is the one place the existing design anticipated an editable summary.

**The direct-purchase path gets no controls.** A Buy-it-now intent renders a synthetic line with `id: "direct"` and `stockQuantity: 0` that is not a cart line at all; a stepper on it would PATCH an item id that does not exist.

**Emptying the cart from checkout** must not leave the shopper on a summary of nothing with a submit button. The screen states the cart is empty and refuses submission, rather than redirecting — a redirect away from a form the shopper has filled in would discard their entry.

### 8. Ships server-first, in two independently useful slices

**Chosen:** server, then admin and storefront. Within that, the layout work and the cart work are separable and may land in either order.

The server accepting a layout no client sends is inert; an admin offering one the API refuses is a form that fails on save. Neither the layout registry entries nor the `catalogConfig` flag needs a migration — both live inside existing JSONB columns, and absent already resolves to the default on read.

## Risks / Trade-offs

- **Five sections now mirror one registry across three repos by hand.** The hazard exists today with two; this makes it five, and a storefront missing a component for a layout the backend offers falls back to the default rather than rendering nothing — so drift is silent. → `scripts/verify-section-variants.ts` iterates `HOME_SECTION_VARIANTS` and covers new sections without being edited; the storefront's `section-layouts.test.ts` pins its tuples. Neither can see across the repo boundary, so the mirroring itself stays a review obligation.
- **A card's stepper is one more thing between a shopper and adding a second item.** A shopper who wants two of something now clicks Add, then +, rather than Add twice. → Add-then-step is the same two actions, and the second is on the same control rather than a re-scan of the card. The alternative — stepper before adding — was considered and rejected in the proposal because it would reveal which products have variants.
- **Two variants of one product in the cart leaves that card without a stepper** (Decision 4). A shopper who added Red and White sees "Add to cart" on a card offering both. → Accepted: the card cannot say which line it would govern, and stepping the wrong variant is worse than offering the action that opens the chooser. Stated in the spec rather than left to be discovered.
- **Suppressing the drawer removes the strongest signal that an add worked.** → The card's existing "Added ✓" state is retained and becomes the confirmation; the header's cart count also updates. A merchant who turns the setting off is choosing a quieter confirmation, which is the point of the setting.
- **The checkout summary becomes mutable at the moment of payment.** A mis-click on a remove control at that moment is costly. → Reuses the same controls the cart page uses, so the interaction is the one the shopper has already met; the idempotency key renews so nothing stale can be submitted; and the empty-cart case is handled explicitly rather than by redirect.
- **A slider hides products below the fold of the row.** A grid shows six at once on desktop; a slider shows six and hides the rest behind an arrow. → It is the merchant's choice per row, the default is unchanged, and the picker's description says what each layout does.

## Migration Plan

Additive throughout, no migration. The three layout entries live inside the existing `homeConfig` JSONB and the flag inside the existing `catalogConfig` JSONB; every stored row reads as "no layout chosen" and "flag at its default", which is what those rows mean.

Deploy **server, then admin and storefront**. The server alone is inert. Rollback is reverting the clients, then the server: a stored `SLIDER` on a product row is read by a reverted server as a layout that section does not offer and resolved to `GRID` on read, without rewriting what is stored — the same path a withdrawn layout takes. A stored flag the reverted server does not know is ignored by its `.strict()` schema on the next write.

## Open Questions

- Whether the `/products` listing, `/deals` and the related-products strip should eventually offer the same layout choice. Deferrable: they need a carrier that is not `homeConfig`, and a filtered, paginated listing is a different question from a merchandising row.
- Whether the card's stepper should clamp to available stock. The cart's stepper has never clamped, checkout re-validates, and changing it is a decision about where stock is enforced rather than about this control — noted as out of scope in the proposal.
