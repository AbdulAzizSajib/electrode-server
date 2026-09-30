## Context

See proposal.md — Why.

Constraints that shape the approach:

- **`chatWidget` is a Json column.** Postgres constrains nothing inside it, so `chatWidgetSchema` is the only thing standing between a careless admin payload and a broken storefront. This is the same rule that governs every other Json block on `StoreSetting`.
- **`GET /settings/public` is an explicit projected allow-list**, not a pass-through of the row. `getPublicStoreSetting` names every field it serves and merges each over `DEFAULT_PUBLIC_SETTINGS`, precisely so a column added later stays private until someone opts it in. `chatWidget` must therefore be added there by hand — it does not become public by existing. That it *may* be opted in is the separate question, and the answer is yes: a phone number and a Messenger handle are already printed on the site.
- **The `(shop)` layout already fetches settings.** `Header`, `Footer` and `MobileBottomNav` all take it as a prop. A widget mounted there is free; a widget that fetched its own settings in the browser would cost a round trip and flash in a beat late.
- **`PATCH /settings` is a partial upsert shared by seven admin editors**, which coexist only because their key sets are disjoint. The chat-widget editor adds exactly one key, `chatWidget`.
- **Both frontends mirror backend validation limits as local constants** and carry an explicit obligation to be kept in step.
- **The migration will emit `DROP INDEX` for the three `pg_trgm` GIN indexes.** Those lines must be deleted from the generated SQL and the NOTE block carried forward, per CLAUDE.md.

## Goals / Non-Goals

**Goals:**

- One footer layout, defined once, rendered identically by the storefront and the admin preview.
- A chat widget that is impossible to enable into a dead link — enforced at validation, again at read, and again at render.
- A merchant path from "nothing configured" to "working bubble" that is a single toggle when a contact phone already exists.

**Non-Goals:**

- **No in-page chat UI.** The bubble is a link out to WhatsApp or Messenger. No message thread, no transcript, no unread badge — the conversation lives in the seller's own app, which is where they already answer.
- **No third-party chat SDK.** No Messenger Customer Chat plugin, no Tawk/Crisp embed. Those ship a script tag that reads the page and tracks the visitor; a link needs neither.
- **No per-page override.** The widget is on for the whole storefront or off. A per-route switch is a setting nobody asked for and another thing to keep in sync.
- **No multi-channel bubble.** One channel at a time. Two bubbles is a decision pushed onto the visitor.
- **`copyrightText` is not removed.** Its column and its admin field stay; only the footer stops rendering it. Dropping a populated column to change a layout destroys merchant text for no gain.

## Decisions

### Decision 1: The agency credit is a storefront constant, not a setting

"Design & Developed by" plus the agency name and URL live in a single module-level constant in `nextjs/`, and the mark itself is an inline SVG component beside it. It is not on `StoreSetting` and there is no admin field for it.

*Why:* this is the builder's credit, not the merchant's content. Putting it on `StoreSetting` would mean handing every merchant an editor for the one line on the page that is not theirs to edit — and the first thing a merchant does with an editable credit is empty it. A constant is also the honest representation of the fact: the value is the same on every deployment, so a per-store column would hold the same string in every row.

*Alternative considered — a `poweredBy` settings block:* rejected above. *Alternative considered — an env var:* an env var is the right shape for something that varies per deployment, and this does not; it would also mean the credit silently vanishes from any environment that forgot to set it.

*Consequence, stated rather than hidden:* changing the agency credit is a code change and a redeploy. That is the intended cost.

*The mark is an inline SVG component, not an asset under `public/`.* This started as a `logoSrc` path and was changed during implementation. A file is the right shape for artwork a deployment swaps; it is the wrong shape for this one, because the lockup's letterforms take `currentColor` and therefore invert correctly against the brand-coloured footer with no second asset. A raster credit would need a light cut and a dark cut, and the footer would load whichever was remembered last. The cost is that a white-label deployment edits two files rather than one — `lib/agency-credit` for the name and URL, `components/ui/AgencyLogo` for the paths.

*The admin preview shows the name as text, not the mark.* The preview is a 4px-padded sketch at a fraction of storefront size, where the traced letterforms would be illegible and the green frame would read as a smudge. Its job is to show the merchant where the credit sits and that it is not theirs to edit, which the name in position already does.

### Decision 2: Social icons move, `socialLinks` does not change

The icons render under `aboutText` inside the brand block. The setting, its shape, its validation, its five-platform enum and its admin editor are all untouched — this is a change of position in one JSX file.

*Why:* the visual grouping the request asks for is "who is this shop, and where else do they exist", and that is the brand block. Nothing about the data needs to move for the rendering to.

The bottom bar consequently has social icons removed from its left half, freeing it for the copyright.

### Decision 3: The copyright renders the store name, not `copyrightText`

The left half of the bottom bar renders `Copyright © <year> | <storeName + siteNameAccent>`, using the same composed brand name the brand slot resolves.

*Why:* the requested format has the store's name in it, and the store's name is already a column — `copyrightText` is free text that on the seeded default reads "Gadgets Mart - Electronics Store. Built with Next.js.", which is a sentence, not a name. Deriving from `storeName` means renaming the shop renames the copyright, and there is no second place to remember to update.

*Alternative considered — keep rendering `copyrightText` and ask merchants to retype it as a name:* rejected. It leaves a populated field whose correct value is now "whatever `storeName` already says", which is a synchronisation obligation with no upside.

`copyrightText` stays stored and editable per the non-goal above. It becomes an unused column on the storefront; the admin field keeps a note saying so rather than silently writing to nothing.

### Decision 4: The WhatsApp fallback resolves on the server, on read

`whatsappNumber` blank → serve `contactPhone`. This happens in `store-setting.service.ts` on the way out, for both the admin read and the public read, so every consumer receives an already-resolved destination.

*Why:* the alternative is each consumer implementing `whatsappNumber || contactPhone` — the storefront widget, the admin preview, and anything added later. Three copies of one rule is three chances for the admin preview to show a different number from the one the storefront dials, which is precisely the class of bug the announcement bar's `source` binding exists to prevent.

*Corollary:* the stored value is never rewritten. A blank `whatsappNumber` stays blank in the database, so a merchant who later changes `contactPhone` gets the new number automatically, and one who fills in `whatsappNumber` gets an explicit override that survives contact edits.

### Decision 5: An unreachable widget is served disabled

When the selected channel's destination resolves to nothing, the read serves `enabled: false` while leaving the stored block untouched (spec: "A previously working widget loses its destination").

*Why:* validation catches the enable-with-no-destination save, but it cannot catch the sequence where a valid widget is saved first and `contactPhone` is cleared afterwards, by a different editor on a different page. Without a read-time guard that sequence floats a `https://wa.me/` link with no number on every page of the shop. Serving it disabled means the failure degrades to "no bubble", which is truthful; the storefront's own render guard is then the third layer, not the only one.

*Why not rewrite the stored row instead:* clearing a contact phone would then destroy the widget configuration, and restoring the phone would not bring it back. Deriving on read makes the recovery automatic.

### Decision 5b: The chat widget is configured on Site Settings, not Footer links

The editor first went on **UI → Footer links**, on the reasoning that that page owns "how a shopper reaches the merchant" — the phone, email and address blocks are there. It has been moved to **UI → Site Settings**.

*Why the first placement was wrong:* the widget floats over every page rather than sitting in the footer, so Footer links is not where anyone looks for it. That page's own description says it edits "the bottom of every storefront page", which the widget is not part of. Grouping by "ways to contact the shop" was an abstraction the merchant does not see; grouping by "where does this appear" is the one they do.

*Consequence:* the disjoint-key rule still holds — `chatWidget` is written by exactly one editor, now Site Settings.

*The admin must refuse an unreachable save, not merely warn.* The backend serves `enabled: false` when the selected channel has no destination (Decision 5), which is correct but INVISIBLE from the admin: the save succeeds, the toast says saved, and no bubble ever appears. This was hit in practice — a widget enabled on the Messenger channel with no username saved cleanly and rendered nothing. Site Settings therefore blocks the save with an inline error naming the missing destination.

### Decision 6: The widget mounts in `(shop)` only

`ChatWidget` is rendered in the `(shop)` layout beside `Footer` and `MobileBottomNav`, taking `settings.chatWidget` as a prop. `(landing)` does not mount it.

*Why:* `(landing)` is deliberately bare — one visitor, one ad, one order form. A floating bubble on a landing page is an exit from the only funnel that page exists to serve. The route-group split already encodes this decision; mounting in `(shop)` inherits it rather than restating it as a condition.

*Positioning:* fixed bottom-right, above the footer, with bottom offset raised on `md:hidden` breakpoints so it clears `MobileBottomNav` and the iOS home indicator — the bottom nav already reserves `env(safe-area-inset-bottom)` and the bubble must not land on top of it.

### Decision 7: The widget is a link, styled as a bubble

An `<a>` with `target="_blank" rel="noopener noreferrer"` to `https://wa.me/<digits>` or `https://m.me/<username>`, carrying an `aria-label` naming the channel. The greeting label renders beside it.

*Why:* it needs no JavaScript, no state and no client component, so it costs nothing on first paint and works before hydration. `wa.me` already opens the app on mobile and WhatsApp Web on desktop, which is the whole behavior a chat SDK would provide here.

*Number formatting:* `wa.me` takes digits only, no `+`, no separators. The service normalises the stored value to `+<digits>` (spec) and the widget strips the `+` at render — the same `replace(/\D/g, "")` the mobile nav already does.

## Risks / Trade-offs

- **A merchant sets a WhatsApp number for a line with no WhatsApp account** → The link opens WhatsApp and reports the number is not registered. Unfixable from our side — no API tells us whether a number has an account without messaging it. Mitigated by the admin field's help text stating the number must be a WhatsApp account, and by the fallback defaulting to the contact phone, which for most stores in this market is the same line.
- **The read-time disable (Decision 5) makes an enabled widget vanish without an error** → A merchant clears their contact phone on Store Settings and the bubble silently disappears from the shop. Mitigated in the admin: the Chat widget editor shows the resolved destination and warns when the widget is enabled but resolving to nothing, so the condition is visible on the page that owns it rather than only on the storefront.
- **Both frontends mirror the channel enum and the field bounds** → A backend change that is not carried into `admin/src/lib/api/store-settings.ts` and `nextjs/src/types/store-settings.ts` desynchronises them. This is the codebase's standing obligation, not a new one; `scripts/verify-chat-widget.ts` pins the backend side and the mirrors carry the usual comment.
- **The migration drops the trigram indexes if the generated SQL is committed as-is** → `ProductService.searchProducts` silently degrades to a sequential scan. Mitigated by the standing CLAUDE.md procedure: delete the `DROP INDEX` lines, carry the NOTE block forward from the most recent migration. Called out as an explicit task rather than left to the reviewer.
- **`copyrightText` becomes a stored column nothing renders** → A merchant edits it and sees no change on the storefront. Mitigated by the admin field's help text saying the footer now shows the store name; the alternative (deleting the column) destroys data, which is worse.
- **The agency credit cannot be changed per store (Decision 1)** → Accepted, and the point of the decision. A white-label deployment that needs a different credit changes one constant and one asset.

## Migration Plan

1. Add the `chatWidget` Json column to `StoreSetting` — nullable, no backfill. An absent block reads as the disabled default, so every existing row is already in a valid state.
2. Generate the migration, **strip the three `DROP INDEX` lines**, carry the NOTE block forward from the most recent migration.
3. Ship the backend (validation, defaults, read-time resolution) before either frontend. The new block is additive and optional, so an older storefront and admin keep working against it unchanged.
4. Ship the storefront and admin in either order. The storefront's `FALLBACK_SETTINGS.chatWidget` is disabled, so a storefront deployed against a backend that has not yet been migrated renders no bubble rather than erroring.

**Rollback:** revert the frontends; the column can stay. An orphaned `chatWidget` block is inert — nothing reads it, and re-deploying restores the configuration merchants had already entered.

## Open Questions

- **The greeting label's default wording.** The reference shows "Chat With Us 👋". Whether the shipped default carries the emoji, and whether the label renders at all on phones where it competes with the bottom nav for width, can be settled during implementation — it changes no requirement, no field, and no task.
