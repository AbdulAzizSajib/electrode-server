## Why

`add-single-product-landing-page` built the right skeleton — one product, one scrollable document, one COD form — but a merchant authoring a real campaign on it today produces a page that reads like a product description. The reference the merchant asked this to match (`mudiowala.com/offer/mudiowala-ghee`) is a page that reads like an offer, and the difference is not styling. It is four things that page has and ours structurally cannot express:

- **A choice of packages.** ৫০০ গ্রাম at ৳৮৪৯ beside ১ কেজি at ৳১৫৯৯ with a free ১ কেজি চিনিগুঁড়া চাল attached, presented as two cards the shopper picks between. Our model binds a page to exactly one product at one price, so the single highest-value conversion element on that page has nowhere to live. A shopper who would have taken the bigger tier is never offered it.
- **A reason to act now.** A countdown to the offer's end, and a progress line — "১০০ জন হতে বাকি আছে ৩৫ জন / ইতিমধ্যে ৬৫ জন কিনেছেন" — against a limited free-gift run.
- **Repeated asks.** That page puts an order CTA above the fold, again after the benefits, again after the usage ideas, and keeps one in a fixed bar at the bottom of the viewport. Ours asks once, at the end, after everything.
- **Proof in the shopper's own terms.** Twelve screenshots of real customer messages, and a usage grid ("গরম ভাতের সাথে", "খিচুড়িতে মাখিয়ে", …) that answers "what would I actually do with this" before the price is asked for.

Ad traffic converts on the first screen or not at all. These are the elements that decide it.

## What Changes

- **Packages: a page can offer more than one.** A new `packages` list, each with its own label, product, price, optional free-gift line and optional highlight badge. The shopper picks one; the order form prices, quotes and orders that package. **BREAKING for the order payload:** a landing-page order gains a package reference. A page that declares no packages keeps behaving exactly as it does today — the single bound product at its own price — so every existing page is unaffected.
- **A countdown, driven by a real deadline.** The merchant sets when the offer ends. The page counts down to it; past it, the countdown does not reset or reappear — it stops being rendered, and the page can be configured to stop taking orders. A campaign that has been "ending in 6 days" for three months teaches shoppers the number is fake, which costs more than it buys.
- **A stock/scarcity line, driven by real orders.** The merchant sets a target ("first 100 buyers get the free rice"); the page reports genuine progress toward it from the order count. **No invented numbers and no configurable starting offset** — a shopper who catches one fabricated figure discounts every other claim on the page, including the true ones.
- **CTAs repeat down the page.** An order button after the hero, after the benefits, after the usage section — each scrolling to the one form — plus a **sticky bottom bar** on mobile carrying the selected package's price and the same action. One form, many doors to it.
- **A "why us" numbered grid and a usage-ideas grid**, both new repeating content lists, both merchant-authored.
- **Review screenshots.** The existing `quotes` list is typed text with a name and a rating. Real campaigns show the screenshot. `quotes` gains an optional image so a merchant can post the message itself, and the storefront renders either.
- **A phone-order CTA.** `tel:` link beside the form, for shoppers who will not type an address into a page they have just met.
- **Campaign theming.** A per-page accent colour and a Bengali display font, so a campaign can look like its product rather than like the shop. The reference page is built on one amber (`#e18820`) against neutral text, with Hind Siliguri for body and Noto Serif Bengali for display.

## Capabilities

### New Capabilities
<!-- None. Every one of these is a section of, or a field on, the landing page
     the storefront-cms/landing-pages capability already describes. Splitting
     "packages" or "countdown" into capabilities of their own would separate
     requirements that only make sense read against the page they sit on. -->

### Modified Capabilities
- `storefront-cms/landing-pages`: Adds requirements for package selection, the offer deadline and its expiry behaviour, the scarcity indicator and its honesty constraint, repeated and sticky CTAs, the two new content grids, review images, the phone CTA, and per-page theming.
- `commerce/landing-page-orders`: Adds the package reference to a landing-page order — which product and price an order is for is no longer implied by the page. Supersedes the existing quote and order requirements, both of which assume exactly one product per page.

**Both are written as ADDED deltas, not MODIFIED, and that needs stating.** Neither capability exists under `openspec/specs/` yet: both belong to `add-single-product-landing-page`, which is still an open change. Archive refuses a MODIFIED against a spec that is not there, so a MODIFIED delta here would produce a change that cannot be archived. Two requirements below therefore restate their originals in amended form under ADDED, each carrying a note saying so.

**Whichever of the two changes archives second must reconcile the overlap.** The versions here supersede the originals, because they are the ones that account for packages. If `add-single-product-landing-page` is archived first, the two restated requirements should be converted back to MODIFIED against the spec it creates.

## Impact

**Schema (migration required)**
- `LandingPage` gains Json columns for `packages`, `whyUs` and `usageIdeas`, scalar columns for the offer deadline and the scarcity target, and a theme block (accent colour, display font). All nullable/optional; a page with none behaves as it does now.
- `Order` gains the landing-page package an order was placed against — `landingPageId` and `landingPageTitle` already exist and record which page; neither records which tier, so per-package revenue would otherwise be underivable.
- Every new Json column is gated only by `landing-page.validation.ts`, like the five already there.

**Code**
- `server/src/app/module/landing-page/` — validation for each new list; `quoteLandingPageOrder` and `placeLandingPageOrder` resolve the chosen package rather than the bound product; the scarcity figure is computed from the order count, never stored.
- `nextjs/src/components/landing/` — new sections, a package selector, a countdown client island, a sticky CTA bar (`LandingStickyCta.tsx` exists and is the place for it), review images in `LandingSections.tsx`.
- `admin/src/features/ui/landing-pages/landing-page-form-page.tsx` — editors for each new list, a deadline picker, the scarcity target, the theme block.
- Three hand-synced type copies as usual: backend interface, `nextjs/src/types/landing-page.ts`, `admin/src/lib/api/landing-pages.ts`.

**Explicitly out of scope**
- **A/B testing between packages or headlines.** Worth having, needs its own change.
- **Reusing the shop's `Campaign` discount schedule for the countdown.** `Campaign` prices products shop-wide; a landing page's deadline is a property of that page. Conflating them would make ending one campaign silently retime another.
- **Any fabricated urgency.** No configurable "customers viewing now", no fake baseline for the scarcity counter, no countdown that restarts per visitor. If a number cannot be derived from real data it is not rendered.
- **A cart.** A shopper picks one package. Multi-item landing-page orders are a different product than this one — the reference page's own "Your order" table showing two lines is a WooCommerce cart leaking through, not a design to copy.
