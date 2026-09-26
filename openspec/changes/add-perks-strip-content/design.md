## Context

`PERKS_BAR` has been a switchable, orderable home-page section since `add-homepage-section-toggles`. Its *content* never moved with it: four objects in the storefront's `data/content.ts` and four `lucide-react` component imports in `PerksBar.tsx`.

The pattern for moving a block of storefront copy onto the settings row is well-worn by now — `add-currency-format-and-home-content-cms` did the header and footer, `add-header-middle-bar-links` did the main row's links, `add-favicon-and-newsletter-section` did the newsletter's wording. This change is the last home-page section to follow it, and the decisions below are mostly about where it should *differ* from those.

## Goals / Non-Goals

**Goals**

- A merchant can rewrite, reorder, add and remove the band's columns without a deploy.
- A store that never opens the screen renders exactly what it rendered before.
- A store that deliberately empties the band gets no band, and that is distinguishable from never having configured one.

**Non-Goals**

- Per-perk colours, backgrounds or links. The band is one colour from `theme.brand` and its columns are statements, not navigation.
- Uploaded artwork per perk (Decision 2).
- A curated icon library or picker in the admin (Decision 2).
- Anything about *whether* the band renders. That is `homeConfig`, unchanged.

## Decisions

### Decision 1 — An ordered array, not a fixed four-slot object

`perks` is `[{ icon, title, description }]` and position is the order.

The alternative was a shaped object — `{ shipping, returns, discount, support }` — which would have made each column individually addressable. It was rejected for the reason `homeConfig` is an array: the order has to be expressible, and an object makes order either implicit in the reader or a second field that can disagree with itself. It also freezes the band at exactly four *roles*, so a shop that wants "Genuine products" in place of "Member discount" would be storing its third promise under a key called `discount` forever.

The cost is that a perk has no stable identity across a save. That cost is nil here: nothing references a perk — no order, no report, no analytics event — unlike an advance-payment account, whose `id` exists precisely because a `Payment` row points at it.

### Decision 2 — Iconify names, not uploads and not a closed set

`icon` is a string resolved by `@iconify/react` at render, the same as `announcementBar.links[].icon` and `middleBarLinks[].icon`.

Three options were on the table:

1. **An uploaded image per perk.** Rejected: these glyphs are tinted with the band's foreground colour (`text-white` over `bg-brand`). An uploaded PNG cannot be re-tinted, so every brand-colour change would silently leave four marks in the old colour.
2. **A closed enum of the four icons the storefront already imports.** Rejected: it makes the fifth perk unrepresentable and the first *renamed* perk absurd — "Genuine products" under a rotate-arrow. It also puts a UI concern into the API's type system, where changing it is a migration.
3. **A free Iconify name.** Chosen. It is already the convention in two other settings columns, the storefront already depends on `@iconify/react`, and an unresolvable name degrades to nothing rather than to an error.

The admin panel draws **no preview**, matching the header links editor: it has no Iconify dependency, so anything it drew would be a second guess at what the site renders.

### Decision 3 — All three fields required, and the band removed by its switch

`perksSchema` requires `icon`, `title` and `description` on every entry, unlike the optional `icon` on a middle-bar link.

A middle-bar link without an icon is a perfectly good text link. A perk without one is a gap in a row of otherwise-aligned columns, because the band's layout puts the mark and the text side by side in every column. The same goes for a missing title: an icon floating over a sentence.

So there is no partially-filled perk, and therefore no way to empty the band by emptying its fields. That is deliberate, and it is the *correction* of the mistake `add-favicon-and-newsletter-section` had to undo: the newsletter block used to be removable only by clearing its heading — an off switch by accident. The band is removed with the `PERKS_BAR` switch, which is what that switch is for.

The admin panel validates the same rule before the round trip. Not for safety — the server is the gate — but because the fields live in a collapsed panel on a screen whose main job is reordering sections, and a server refusal would lose a reorder made in the same visit over a blank input the merchant cannot see.

### Decision 4 — `merge()`, so null and `[]` stay different

The public read uses `merge(stored?.perks, DEFAULT_PERKS)`, which substitutes only on null/undefined.

- **null** — the column was never written. Resolves to `DEFAULT_PERKS`, the four columns the storefront hardcoded. This is what makes the migration invisible on deploy and a backfill unnecessary.
- **`[]`** — the merchant removed every column. Served as empty; the storefront renders no band.

Swapping the default in for any falsy value would make "no perks" inexpressible, which is exactly the hazard `middleBarLinks` documents one line above. A store that deliberately cleared the band would find it back on the next render, forever, with no way to stop it.

`DEFAULT_PERKS` is reached by two roads that must both be right, like `homeConfig`: an unconfigured store, and a storefront whose settings read failed entirely (`FALLBACK_SETTINGS`). Serving the real band in both is the safe direction — a shopper cannot tell a missing band from an outage.

### Decision 5 — Capped at four, and the cap is about the row

`MAX_PERKS = 4`. The band is a single row of equal columns: one across on a phone, two on a tablet, four on a laptop. A fifth either wraps into a ragged second row or squeezes all of them until the supporting lines break mid-word.

The same kind of bound as `middleBarLinks`' cap of 4 — a limit on how far a merchant can crowd a row whose constraints they cannot see from the admin panel, not a storage limit. The storefront reads the *actual* length rather than assuming four: with two or three perks it drops to a matching column count, because `lg:grid-cols-4` with two perks left half the band empty and the pair huddled on the left.

### Decision 6 — Edited from the Home sections row, not a screen of its own

The admin panel puts the fields in the `PERKS_BAR` row's disclosure panel, beside the switch that decides whether the band appears and the handle that decides where it sits.

The same call the newsletter's wording made, and the same one the featured-categories layout made: this page already owns and writes `homeConfig` wholesale, and a second screen writing the same settings row is the hazard the hero's layout picker was moved to Home Slider to *avoid*. Nothing about a perk needs a screen that can draw something — there is no artwork sizing to show and no layout to diagram.

The consequence is that Home sections now writes three keys — `homeConfig`, `newsletter` and `perks`. Disjointness still holds: nothing else has ever written `perks`.

## Risks / Trade-offs

- **A merchant can type an icon name that does not resolve.** The column renders with no mark and the text shifts left. Mitigated only by the placeholder and the note pointing at iconify.design; validating a name would mean the server holding a copy of Iconify's catalogue and going stale against it. Judged acceptable: the failure is visible on the merchant's own home page immediately.
- **`DEFAULT_PERKS` is mirrored in three repositories** (here, `admin/src/lib/api/store-settings.ts`, `frontend/src/services/store-settings.ts`) and kept in step by hand, exactly like `DEFAULT_MIDDLE_BAR_LINKS`. The admin mirror is load-bearing and tested: the admin read returns the row as stored, so seeding from `null` rather than from the default would let a merchant's unrelated reorder **delete a live band they never touched**.
- **The shipped copy makes a specific promise** ("For orders over ৳130") that is now, for the first time, stored rather than compiled in. It was already being published; this change makes it editable, which is a net improvement on a claim that was previously unfixable.
