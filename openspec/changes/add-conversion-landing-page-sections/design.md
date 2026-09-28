## Context

See proposal.md — Why. This records only what the existing code forces on the approach.

Five facts shape everything below:

1. **`LandingPage.productId` is a required, restricted FK**, and `buildProductSnapshot(landingPage.productId)` is the single place the page's product becomes a price. Both the public read and the preview call it; `quoteLandingPageOrder` resolves the same id independently (`landing-page.service.ts:611`). Packages have to change what that id *is*, not add a second pricing path beside it.
2. **The quote and the order must agree exactly or every order fails.** `quoteLandingPageOrder` prices offer-price-less-running-campaign, and the form submits that total as `expectedTotal`, which placement compares against its own figure and refuses with a 409. The service's own comment records this having already happened once: a quote that charged bare `offerPrice` broke *every* order from the page for as long as a campaign ran. A package that is priced in one path and not the other reproduces that bug exactly.
3. **`Order` already carries `landingPageId` and `landingPageTitle`**, the latter captured at placement and never updated, so deleting a page leaves its orders readable. Packages need the same treatment and for the same reason.
4. **The five existing Json columns are gated only by `landing-page.validation.ts`** — Postgres constrains none of them. Three more columns means three more schemas and no other safety net.
5. **`LandingStickyCta.tsx` already exists**, so the sticky bar is an extension of a component, not a new one.

## Goals / Non-Goals

**Goals:**
- Packages resolve to a product+price in ONE place that quote, page render and placement all read, so fact 2 cannot recur.
- Every urgency element is derived from something real — a stored instant, a counted row — and is structurally incapable of being fabricated.
- A page that adopts none of this renders byte-for-byte as it does today.

**Non-Goals:**
- Changing how the bound product is priced. Campaign application, tax and delivery all stay exactly as they are; a package changes *which* product and *what* price, not the pipeline that charges it.
- Making `productId` nullable. See Decision 1.
- Per-visitor anything. No cookie-scoped countdown, no session-scoped counter.

## Decisions

### Decision 1 — a package is an override, and `productId` stays required

A package carries its own `productId` and its own price. The obvious modelling is to make `LandingPage.productId` nullable once packages exist — "the page has packages instead of a product". Rejected:

- `productId` is `onDelete: Restrict`, and that restriction is what stops a merchant deleting a product out from under a live campaign. Nullable, a page could exist with no product to restrict on.
- Every existing read (`buildProductSnapshot`, both slug reads, the quote) assumes it. Making it optional means every one of them grows a branch, and the branch that handles "neither" is unreachable but must still be written.

So: the bound product remains the page's default and its fallback. A page with no packages uses it, exactly as today. A page WITH packages uses the selected one, and the bound product is what the page falls back to if every package is later removed. Nothing becomes nullable and no existing read changes shape.

**One resolver.** `resolveLandingPackage(page, packageKey)` returns `{ productId, unitPrice, label, freeGiftText }` — for a page with no packages it returns the bound product and its own price. `buildProductSnapshot`, the quote and placement all call it. That is the whole defence against fact 2: there is one answer to "what does this page sell right now", and three callers of it.

**A package's PRICE is authored, not read from the product.** This is the one place this change departs from the model's stated rule that no price lives on a landing page. It has to: ৫০০ গ্রাম and ১ কেজি are *different products* at different prices, and a package that could only display its product's own price would make the package list a product list. The rule's purpose — that a shop never quotes one number and charges another — is preserved by the resolver: the authored price is what the quote uses AND what placement charges, so the two cannot diverge. The model comment must be amended to say this rather than left contradicting the code.

**Key, not index.** Packages are addressed by a stable authored key like delivery zones are, never by position. An order records the key and a snapshot of the label and price, so reordering or deleting a package cannot reattach an old order to a different tier.

### Decision 2 — the countdown is a stored instant, rendered by a client island

`offerEndsAt` is a nullable timestamp. The server sends it; a small client component renders the remaining time and stops at zero. Not server-rendered text, which would be wrong the moment it was cached, and not a duration ("6 days from first visit"), which is the fabrication the proposal rules out — a per-visitor countdown is a different deadline for every shopper and cannot be honest about anything.

The page is already `revalidate`-cached, so the countdown must be computed **in the browser from the absolute instant**, not from a server-rendered remainder.

**Enforcement is separate from display.** `stopOrdersAtDeadline` is its own boolean because the two are genuinely different merchant intents: "show urgency" and "actually close the offer". The order refusal is decided in `placeLandingPageOrder` against the server's own clock — a client that ignores an expired countdown must still be refused, so the display is a courtesy and the service is the control.

### Decision 3 — the scarcity figure is COUNTED, never stored

`scarcityTarget` is a nullable integer — the size of the run. The taken figure is `COUNT(*)` of that page's orders, computed on read. There is deliberately no column to store a count in and no field to seed one with, because a stored counter is a field someone can set, and the moment it can be set it will be set to something flattering.

The count is the page's real order count, which means it includes orders later cancelled. That is a known, accepted imprecision: the alternative is filtering by status, which makes the number move *backwards* when a merchant cancels a fake order — visibly, on a public page. Overcounting slightly is better than a public figure that decreases.

Served by the existing `@@index([landingPageId])` on `Order`.

**Alternative considered:** a "customers viewing now" figure, which the reference-style pages often carry. Rejected outright — there is no honest source for it, and inventing one is the thing this whole decision exists to prevent.

### Decision 4 — accent colour is a token, not a style string

The page's accent is stored as a strict hex value and interpolated as a CSS custom property on the page's own wrapper. Never as a class name, never as an inline style string the merchant composes. `StoreSetting.theme` already takes exactly this posture and states the reason: the value reaches an inline `style` attribute, so anything that could carry further declarations is refused at the schema.

The display font follows `theme.font`'s existing shape — a validated family plus a URL **rebuilt** from validated components, never a substring of merchant input.

Scoped to the page's wrapper element, so a campaign's theme cannot leak into the shop's chrome. The `(landing)` route group has none anyway, which is what makes this safe to do per-page at all.

### Decision 5 — the sticky bar is the existing component, widened

`LandingStickyCta.tsx` exists. It gains the selected package's price and an explicit "do not obscure the form" behaviour — an intersection observer on the form, hiding the bar while the form is in view. Without that the bar covers the submit button on a phone, which is the one element on the page that must never be covered.

Mobile only. On a desktop viewport the form is reachable by scrolling and a fixed bar is chrome for its own sake.

### Decision 6 — three new Json lists, following the five already there

`packages`, `whyUs` and `usageIdeas` are Json columns with Zod schemas and item caps, exactly like `highlights` and `faqs`. No new pattern, no new table:

- A table for packages would mean a join on the hottest read on the site, for a list bounded at a handful of rows.
- The existing five prove the shape works and the admin editor pattern already handles repeating lists.

Review images extend the existing `quotes` schema with an optional `imageUrl` rather than adding a sixth list, because a screenshot and a typed quote are the same thing — a customer's words — and splitting them would make the merchant choose which section to put a review in.

## Risks / Trade-offs

**A package's authored price can drift from its product's real price** → The merchant edits the product to ৳900 and the package still says ৳849, so the page advertises one number and the order charges it. This is a real cost of Decision 1 and cannot be designed away without giving up packages. Mitigations: the admin shows the product's current price beside the authored one and warns when they differ; the verify script asserts the quote and placement agree for every package on a page. The page deliberately keeps charging the authored price — a page that silently charged more than it advertised would be worse.

**Scarcity count includes cancelled orders** → Stated in Decision 3, accepted deliberately. The number can only ever overstate, never decrease in public.

**Three more hand-synced type copies** → Backend interface, `nextjs/src/types/landing-page.ts`, `admin/src/lib/api/landing-pages.ts`. The project already carries this obligation for five lists; this adds three. A verify script asserting the shapes agree is part of the work, not a follow-up.

**Countdown flashes on hydration** → The server cannot render the remainder (Decision 2), so there is a moment with no timer. Rendering nothing until hydration is correct but looks broken; the section reserves its space and shows the deadline's date until the timer takes over.

**More sections is not more conversion** → Every section here is optional and off by default. A merchant who authors none gets today's page. The risk is a merchant filling all of them and producing a page nobody scrolls to the end of; that is an authoring judgement the admin can hint at but should not enforce.

## Migration Plan

1. **Schema first, everything optional.** New columns are nullable/absent-defaulting; no backfill. Every existing page reads as "no packages, no deadline, no target, shop theme" — which is what it is.
2. **Watch the generated migration for the three trigram `DROP INDEX` lines** and delete them, carrying forward the NOTE block. This change touches unrelated models, which is exactly when that is easiest to miss.
3. **Backend, then admin, then storefront.** The columns must be writable before the editors ship and configured before the storefront reads them. A storefront deployed early reads absent columns and renders today's page.
4. **Rollback** is removing the authored content: a page whose packages are deleted falls back to its bound product by Decision 1's fallback, so the page keeps working rather than breaking. Orders already placed against a package keep their captured snapshot.

## Open Questions

- **Whether the usage-ideas grid takes icons or small images.** It changes the admin editor's control and nothing else — no requirement, no backend shape. Settle it when that section is built.
- **Where per-package revenue surfaces in the admin** — on the landing page's own row, or in the reports section. The data is the same either way; only the placement is open.
