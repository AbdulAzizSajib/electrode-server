## Why

The storefront footer's bottom bar reads as an afterthought: the social icons sit on the left of a divider rail, detached from the brand block they belong to, and the right side carries only `© <year>, <copyrightText>`. The intended layout puts the social icons directly under the brand name and about text — where a visitor looks for "who is this shop" — and reserves the bottom bar for two balanced halves: the copyright with the store's own name on the left, and the agency's "Design & Developed by" credit on the right.

Separately, the shop has no persistent way to start a conversation. A customer on a product page who wants to ask about size or stock has to scroll to the footer for a phone number, or find the WhatsApp item that only exists in the mobile bottom nav. Competing storefronts float a chat bubble on every page; this one does not, so those questions turn into abandoned carts instead of orders.

## What Changes

**Footer layout**

- Social icons move out of the bottom bar and into the brand block, rendering directly beneath `aboutText` — the same links, the same `socialLinks` setting, a new position.
- The bottom bar becomes two halves: `Copyright © <year> | <store name>` on the left, and `Design & Developed by <agency logo linking to the agency site>` on the right.
- The left half renders the **store's own name** (`storeName` + `siteNameAccent`, the same value the brand slot uses) rather than the free-text `copyrightText`. `copyrightText` stays on `StoreSetting` and stays editable, but the footer no longer renders it — no column is dropped and no merchant text is destroyed.
- The agency credit is a **fixed, non-merchant-editable** constant in the storefront: one logo asset and one URL, identical on every deployment. It is deliberately not a setting — see design.md Decision 1.
- The admin's Footer links **preview** is updated to match, so what a merchant previews is what the storefront renders.

**Floating chat widget**

- A new persistent chat bubble, fixed bottom-right on every `(shop)` route, opening a conversation with the seller in one tap.
- Merchant-configurable through a new `chatWidget` block on `StoreSetting`: an `enabled` toggle, a `channel` of `whatsapp` or `messenger`, a `whatsappNumber`, a `messengerUsername`, and a short `greeting` label shown beside the bubble.
- `whatsappNumber` falls back to `contactPhone` when blank, so a merchant who already filled in their contact phone gets a working widget by flipping one toggle.
- The widget renders nothing at all when disabled, or when the selected channel has no destination — an enabled toggle is never enough on its own to put a dead link on every page.
- Not rendered on `(landing)` routes, which are deliberately bare — one visitor, one ad, one order form.
- A new admin editor section on **UI → Footer links** writes the block, following the existing settings-editor pattern and the disjoint-key rule for `PATCH /settings`.

No breaking changes: every new field is optional with a defined absent-state, and the footer restructure is presentational.

## Capabilities

### New Capabilities

_None._ The chat widget is new behavior but it is store-settings behavior — it is a block on the existing singleton, served and validated by the existing settings endpoints, so it belongs in the capability that already owns them rather than in a capability of its own.

### Modified Capabilities

- `api/support-and-admin`: store settings gain a `chatWidget` block whose validation rules are load-bearing rather than shape-only — the channel selects which destination field is required, and a widget with no reachable destination must not be servable as enabled. Adds requirements covering that validation and the `whatsappNumber` → `contactPhone` fallback resolution.

## Impact

**`server/`**
- `prisma/schema/StoreSetting.prisma` — new `chatWidget` Json column. Migration required; the trigram-index `DROP INDEX` lines must be stripped from the generated SQL per CLAUDE.md.
- `store-setting.validation.ts` — new `chatWidgetSchema`; it is a Json column, so this schema is the only gate.
- `store-setting.interface.ts` — `IChatWidget`, `IChatWidgetChannel`.
- `store-setting.constant.ts` — `DEFAULT_CHAT_WIDGET` in both the seed defaults and the public-read defaults.
- `store-setting.service.ts` — the `whatsappNumber` → `contactPhone` fallback resolves on read, so both frontends receive an already-resolved destination.
- `GET /settings/public` serves the row with `findUnique` + `include`, so `chatWidget` is public by construction — it holds no secret, which is a precondition for putting it there at all.
- Fires the existing `store-settings` revalidate tag; no new tag.
- New `scripts/verify-chat-widget.ts`.

**`nextjs/`**
- `components/layout/Footer.tsx` — social icons relocate; bottom bar rebuilt as two halves.
- New `components/layout/ChatWidget.tsx`, mounted in the `(shop)` layout only.
- New agency-credit constant + logo asset under `public/`.
- `types/store-settings.ts` and `services/store-settings.ts` — `ChatWidget` type, mapper entry, and a `FALLBACK_SETTINGS.chatWidget` that is disabled, so an unreachable backend never floats a dead bubble.

**`admin/`**
- `features/ui/footer-links/footer-links-page.tsx` — new Chat widget editor section; `FooterPreview` updated to the new bottom-bar layout.
- `lib/api/store-settings.ts` — `ChatWidget` type, `CHAT_CHANNELS`, and `SETTINGS_LIMITS` entries mirroring the backend bounds.
- The new keys must stay disjoint from every other settings editor's key set.

**Not affected**: `copyrightText` remains a stored, editable column — only its footer rendering is dropped. The mobile bottom nav's existing WhatsApp item is left as-is.
