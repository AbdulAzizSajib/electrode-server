## Context

See proposal.md — *Why*. What follows is only the existing structure this design has to fit into.

**`StoreSetting` is a validated singleton.** One row keyed `"singleton"`, upserted, never duplicated. Its five `Json` columns (`mainNav`, `footerColumns`, `socialLinks`, `announcementBar`, `newsletter`) are gated exclusively by Zod schemas in `store-setting.validation.ts` — Postgres constrains nothing — and reads are correspondingly trusted. `GET /settings/public` is an explicit **allow-list** projection using `findUnique` (never the upsert), merged over `DEFAULT_PUBLIC_SETTINGS`. Three editors already write disjoint subsets of this row through one `PATCH /settings`, relying on every field being optional so a partial payload cannot clobber a block the sender never showed.

**Guest order validation is currently one hardcoded line.** [`order.service.ts:440`](server/src/app/module/order/order.service.ts#L440) is `if (!payload.fullName || !payload.phone || !payload.shippingAddress)`. Immediately after, `getOrCreateCustomerByPhone(payload.phone, payload.fullName)` uses the name to create the customer record, and `enforceGuestOrderLimits(customer.id, actor.ip)` applies the per-phone COD cap.

**Shipping is priced by region, with a fallback chain.** `shipping-rule.service.ts` matches `country+state` → `country` → catch-all (`country: null, state: null`), returning `null` when nothing matches — and a `null` match is refused as undeliverable rather than charged zero. The storefront sends the shopper's **City** as `state`, for both the quote and the order.

**The compiled stylesheet confirms the theme tokens are overridable.** In the built CSS: `@layer theme { :root, :host { --font-sans: "Outfit", … } }`, an unlayered `:root { --color-brand: #0f63b3; … }`, utilities emitted as `.bg-brand { background-color: var(--color-brand) }`, and `body { font-family: var(--font-sans) }`. So the six colours and the font reach every one of their 239 call sites through a custom property, and nothing needs a per-component change. `max-w-346` (346 × 0.25rem = 86.5rem = **1384px**) is *not* a variable — it is a literal repeated 23 times across 16 files.

**Postman is three byte-identical copies** (`server/`, `admin/`, `frontend/`), checked by `pnpm -C server verify:postman`, which parses the route files rather than introspecting Express.

## Goals / Non-Goals

**Goals:**

- Store both new settings blocks in the existing singleton, gated the same way the existing JSON columns are, so there is one write path and one validation story.
- Make the checkout config authoritative at the API, not just in the form.
- Let theme values reach the storefront without a redeploy, without a second network request, and without a flash of the default theme.
- Accept a pasted Google Fonts embed without ever putting merchant-pasted text into a rendered page.

**Non-Goals:**

- Email capture at checkout. Decided out of scope; nothing in this change adds an email field, column, or toggle.
- Dark mode, or any second palette. Six tokens, one theme.
- Self-hosting font files, or a font picker/browser. The merchant pastes an embed; we parse it.
- Per-page overrides of colour, font or width. These are site-wide.
- Making the footer's dark chrome (`text-white/80`, `border-white/10`) themeable — those are hardcoded and stay hardcoded here.
- Reworking how coupons are validated or applied. The switch controls visibility only.

## Decisions

### D1 — Scalar columns for single values, one JSON column per structured block

`footerLogoUrl`, `siteUrl`, `metaTitle`, `metaDescription` become **plain nullable scalars**, mirroring the existing `logoUrl` / `copyrightText` / `siteNameAccent`. `checkoutConfig` and `theme` become **two `Json` columns**, following the precedent of `mainNav` and friends.

The rule: a single value that a query might one day filter or sort on is a column; a structured set edited as a unit is JSON. Splitting the checkout config into ~14 boolean columns would mean a migration every time a checkout field is added and a form that maps 14 names by hand. Conversely, burying `siteUrl` in JSON would make it unqueryable for no benefit.

*Alternative considered:* one `siteSettings` JSON blob for everything on the Site Setting page. Rejected — it would move the four existing branding scalars into JSON, a data migration with no upside.

### D2 — The checkout config is a field-keyed map, and its invariants live in Zod

```
{
  fields: {
    fullName:     { show: bool, required: bool },
    phone:        { show: bool, required: bool },
    addressLine1: { show: bool, required: bool },
    addressLine2: { show: bool, required: bool },
    city:         { show: bool, required: bool },
    postalCode:   { show: bool, required: bool }
  },
  showCouponBox:      bool,
  showOrderNote:      bool,
  allowGuestCheckout: bool,
  notice:             string   // max 300
}
```

The keys are deliberately **the payload keys the order API already accepts** — `fullName`, `phone`, and the four under `shippingAddress`. That lets server validation be a loop over the map rather than a switch statement that has to be kept in step with the admin table.

Two invariants are `superRefine` checks on the schema, so a contradictory config cannot be persisted by any path:

1. No field may be `{ show: false, required: true }` — that describes a checkout nobody can complete.
2. `phone` must be `{ show: true, required: true }` — see D3.

Both are `.strict()` like the existing nav schemas, so an unknown field key is an error rather than a silently stripped one.

### D3 — Enforcement replaces the hardcoded check, and phone is belt-and-braces

The line at `order.service.ts:440` becomes a loop over `checkoutConfig.fields`, collecting the names of required-but-absent fields and throwing one `400` that names them. Three consequences to handle explicitly:

- **`getOrCreateCustomerByPhone(phone, fullName)`** is called with a name that may now legitimately be absent. It falls back to the constant `"Guest"` rather than an empty string, so no customer record is created nameless.
- **Guest checkout disabled** throws `401 UNAUTHORIZED` at the top of the guest branch, before the address is created or any limit is checked. The storefront redirect is a courtesy; this is the enforcement.
- **Phone stays hardcoded-required in the service**, in addition to being un-disableable in the schema. The schema stops a bad config being *saved*; the service check stops a hand-edited database row from disabling order lookup and the COD cap. The two guards are independent on purpose.

*Alternative considered:* keeping the server's floor fixed and treating the toggles as presentation-only. Rejected in the requirements gathering — a "Required" checkbox that the API ignores is an admin panel that lies.

### D4 — Making City optional degrades shipping to the country rule, and the admin says so

Because City is sent as `state`, an empty City drops the shipping match from `country+state` to `country`, then to the catch-all. A merchant who prices only by region and has no country-level or catch-all place will find that **every order becomes undeliverable and is refused**.

This is not a reason to forbid the setting — a merchant with flat-rate shipping has every right to stop asking for a city. It is a reason to say so at the moment of the decision: the admin renders an inline warning on the City row when its Required is turned off, naming the fallback and the consequence. No server-side coupling between the two modules; the warning is static copy.

### D5 — The font is parsed, validated against a host allow-list, and **rebuilt** — never echoed

Server-side, on write:

1. Extract the first `https://fonts.googleapis.com/css2?…` (or legacy `/css?…`) URL from the input with a regex that tolerates all three paste forms — `@import url("…");`, `<link href="…" rel="stylesheet">`, and the bare URL.
2. Parse with `new URL()`. Reject unless `protocol === "https:"` **and** `hostname === "fonts.googleapis.com"` exactly — an equality check, never `endsWith`, which `fonts.googleapis.com.evil.test` would pass.
3. Read the `family` parameter; the family name is the part before the first `:`, with `+` decoded to spaces (`Open+Sans` → `Open Sans`). Reject if absent.
4. **Reconstruct** the stored URL from the validated origin, path, and a re-serialised query built from the recognised parameters (`family`, and `display`, forced to `swap`). Store `{ family, url }`.

Step 4 is the important one. The stored URL ends up in a `<link href>` on every page, so nothing attacker-controlled may survive as a substring — rebuilding from parsed components rather than storing the input string is what makes that true, and it is why the spec requires the paste never be stored verbatim.

*Alternatives considered:* `next/font/google`, which resolves the family at **build** time and so cannot take a runtime value; and a curated dropdown of N families, which is safer still but is precisely the "pick from our list" experience the request asked to avoid.

### D6 — Theme is delivered as an inline `style` attribute on `<html>`, not a `<style>` block or a CSS route

```jsx
<html lang="en" className="h-full antialiased" style={themeVars}>
```

where `themeVars` is `{ '--background': …, '--color-brand': …, '--font-sans': …, '--site-max-width': … }`.

An element's inline style wins over any stylesheet rule regardless of layer or source order. That sidesteps the whole question of where Next.js and React hoist an injected `<style>` relative to the Tailwind stylesheet — a question whose answer could change with a framework upgrade and whose failure mode is a silently un-themed site. It is server-rendered in the same response the layout already produces, which is what satisfies the no-flash requirement.

`--font-sans` is inherited from `<html>` down to `body`, whose `font-family: var(--font-sans)` rule then resolves to the merchant's family. Note that Tailwind's preflight sets `html { font-family: var(--default-font-family) }` with the Outfit literal **baked in** by `@theme inline`; that rule is not overridden and does not need to be, because every rendered element lives inside `<body>` and `body`'s own rule wins for all of them.

No extra fetch: `layout.tsx` already awaits `getStoreSettings()` for the header and footer. The values are re-validated against the hex/width patterns at render, immediately before interpolation — cheap defence in depth against a database row edited outside the API.

`globals.css` keeps its `:root` values unchanged. They are now the documented fallback, which is exactly what a failed settings read (`FALLBACK_SETTINGS`) or an unconfigured store should land on.

*Alternative considered:* a `/theme.css` route. Rejected — a second blocking request in the critical path and a second cache to reason about, to solve a problem the inline attribute does not have.

### D7 — `.site-container` replaces `max-w-346` at all 23 call sites

```css
.site-container {
  max-width: var(--site-max-width, 90rem);
  margin-inline: auto;
}
```

`90rem` is the 1440px default. This shipped as `86.5rem` — exactly `max-w-346` — so an unconfigured store was pixel-identical at the time; closing the width to a fixed set of options later moved the default to 1440, because 1384 is not one of them (see the revised paragraph below). Full-width is expressed as `--site-max-width: 100%` rather than a second class, so the storefront has one code path. `container-px` stays as it is and continues to supply the side padding — which is what keeps content off the viewport edge in full-width mode.

The edit is mechanical: `mx-auto max-w-346` → `site-container` (and `max-w-346` alone → `site-container`, since `margin-inline: auto` is already what those sites want). It must be a complete sweep — one missed call site is a row that stays 1384px wide while the rest of the page narrows, which reads as a layout bug rather than a missed edit.

Admin stores the width as an integer in px — one of the four offered widths, 1140 / 1280 / 1440 / 1600 — or the full-width sentinel; the storefront converts to a px length or `100%` at render.

This shipped as a free range bounded 960–2560. It was closed to a fixed set once the homepage hero was made proportional to this value: with a free range the hero's slider took a shape no artwork had been cut for — portrait at a narrow width, 2.3:1 at full width — and the banner sat inside empty bands either way. Four options a merchant picks from cannot produce that, and they let the admin state one recommended upload size per hero slot that stays correct at every width. A stored width outside the set is not rejected on read: both the storefront and the admin snap it to the nearest offered width, so a store configured before the set closed keeps rendering.

### D8 — Branding moves surface, not storage

Both admin pages keep sending partial `PATCH /settings` payloads containing only their own fields, which is what already keeps the three existing editors from clobbering each other. Removing the Branding block from `store-settings-page.tsx` therefore needs no coordination: it simply stops sending those five keys. The old page gains a short line pointing at UI → Site Setting so an admin with muscle memory is not left hunting.

### D9 — Public projection additions are opt-in, one line each

`getPublicStoreSetting` gains explicit entries for `footerLogoUrl`, `siteUrl`, `metaTitle`, `metaDescription`, `checkoutConfig` and `theme`, each merged over its default. The allow-list stays an allow-list — nothing is added by spreading the row. `DEFAULT_CHECKOUT_CONFIG` and `DEFAULT_THEME` mirror today's behaviour and today's `globals.css` values respectively, so an unseeded install renders and checks out exactly as it does now.

## Risks / Trade-offs

- **A merchant turns off City and every order becomes undeliverable** (see D4) → Inline warning on the row at the point of decision, naming the country/catch-all fallback. Not blocked: it is a legitimate configuration for flat-rate shipping.
- **A merchant picks an unreadable colour pair** (white on white, brand-on-background with no contrast) → The Site Setting page renders a live preview swatch and a computed contrast ratio for the background/foreground pair. Advisory, not blocking — merchants own their brand, and a hard gate would be wrong.
- **Theme edits take up to 5 minutes to appear**, because `getStoreSettings()` is cached with `revalidate: 300` → Documented in the admin page ("changes appear on the storefront within a few minutes"). Left as-is rather than dropping the cache: the settings payload is on every page of the site, and uncached would be a real cost to fix a cosmetic delay.
- **Google Fonts is a third-party request** on every page load, and is blocked in some networks and jurisdictions → The fallback stack is retained behind the merchant's family, so a blocked stylesheet degrades to system fonts rather than breaking layout. Self-hosting is a Non-Goal here.
- **The `max-w-346` sweep is 23 edits and easy to leave incomplete** → A grep for `max-w-346` returning zero matches is an explicit completion check in tasks, not a matter of review attention.
- **A database row edited outside the API could carry a malformed colour or a hostile font URL** → Values are re-validated at render (D6) and the URL is stored already-rebuilt (D5), so neither the write path nor the read path trusts the column alone.
- **Checkout gains a settings dependency it did not have** — if the settings read fails, checkout must still work → The storefront's existing `FALLBACK_SETTINGS` pattern is extended to both new blocks, and the server falls back to `DEFAULT_CHECKOUT_CONFIG` when the column is null or unparseable. A settings outage degrades to today's behaviour, never to an unusable checkout.

## Migration Plan

1. **Server first.** One additive Prisma migration: six new nullable columns, no backfill — defaults live in code (`DEFAULT_CHECKOUT_CONFIG`, `DEFAULT_THEME`) and are merged on read, which is how an existing store keeps behaving identically without a data write. Deploying this alone changes nothing observable: the public projection gains fields no client reads yet, and order validation falls back to the defaults, which reproduce the current hardcoded rule exactly.
2. **Frontend.** Storefront starts consuming the new blocks. Safe against an older server: unknown-or-missing blocks hit the fallbacks.
3. **Admin.** The two new pages, and the Branding block removed from Store Settings. Last, so a merchant cannot save a config the deployed server does not yet honour.
4. **Postman.** Update `server/postman/`, then copy byte-identical to `admin/` and `frontend/`; `pnpm -C server verify:postman` must pass.

**Rollback:** each step reverts independently. The columns are additive and nullable, so rolling back admin or frontend leaves stored settings unread but intact — no data loss and no cleanup. Rolling the server back to the previous version restores the hardcoded checkout rule; any saved config becomes inert rather than harmful.

## Open Questions

- Should saving settings actively bust the storefront's 5-minute cache (a revalidation hook) rather than waiting it out? Deferrable — it changes no contract, no spec scenario and no task here, and is a strictly additive improvement once the feature is in merchants' hands and the delay is either a real complaint or not.
- Whether the six colour tokens eventually want a paired dark-mode set. Out of scope by decision, and additive if it is ever wanted: a second block alongside `theme` rather than a change to it.
