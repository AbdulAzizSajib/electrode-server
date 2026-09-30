## 1. Backend — schema and contract

- [x] 1.1 Add the `chatWidget` Json column to `prisma/schema/StoreSetting.prisma` with a `///` doc comment stating it is publicly served, holds no credential, and that a blank `whatsappNumber` resolves to `contactPhone` on read; verify `npx prisma validate` passes.
- [x] 1.2 Run `npm run migrate --workspace server`, then open the generated SQL and **delete the three `DROP INDEX` lines** for `Product_name_trgm_idx`, `Product_sku_trgm_idx` and `Brand_name_trgm_idx`, carrying the NOTE block forward from the most recent migration; verify by grepping the new migration for `DROP INDEX` and getting no hits, and that `NOTE` is present.
- [x] 1.3 Add `IChatWidgetChannel` (`"whatsapp" | "messenger"`) and `IChatWidget` to `store-setting.interface.ts`, and the field to the settings payload interfaces; verify `npm run lint --workspace server` passes.
- [x] 1.4 Add `chatWidgetSchema` to `store-setting.validation.ts` — `enabled` boolean, `channel` enum, optional `whatsappNumber` / `messengerUsername` / `greeting` with bounds, a phone regex accepting digits with an optional leading `+` and separators, and a refinement requiring the selected channel's destination **only when `enabled` is true**; wire it into the PATCH schema as `.optional()`. Verify by asserting the schema rejects `{enabled: true, channel: "whatsapp", whatsappNumber: ""}` and accepts the same object with `enabled: false`.
- [x] 1.5 Normalise `whatsappNumber` to `+<digits>` inside the schema's transform so separators never reach storage; verify `+880 1782-521705` parses to `+8801782521705`.
- [x] 1.6 Add `DEFAULT_CHAT_WIDGET` (disabled, `whatsapp`) to `store-setting.constant.ts` in both the seed defaults and the public-read defaults; verify a fresh seed produces a row whose `chatWidget` is the disabled default.

## 2. Backend — read-time resolution

- [x] 2.1 In `store-setting.service.ts`, add a single `resolveChatWidget(row)` helper applied on the way out of **both** the admin read and the public read: fill a blank `whatsappNumber` from `contactPhone`, and force `enabled: false` when the selected channel's destination resolves to nothing. Never write back to the row. Verify both read paths return identical `chatWidget` for the same row.
- [x] 2.2 Add a doc comment on `resolveChatWidget` recording design.md Decision 4 and Decision 5 — why the fallback resolves server-side once rather than in each consumer, and why an unreachable widget is served disabled rather than rewritten.
- [x] 2.3 Confirm the existing settings-update path fires the `store-settings` revalidate tag after the transaction resolves; no new tag is needed. Verify `npx tsx scripts/verify-revalidate-tags.ts` still passes.

## 3. Backend — verification script

- [x] 3.1 Write `scripts/verify-chat-widget.ts` importing the service directly, creating `__verify_*` state and cleaning up in a `finally`. It must pin every scenario in the delta spec: enable-with-no-destination rejected for each channel, disabled-with-blank-destination accepted, separator normalisation, `contactPhone` fallback on both reads, explicit number overriding the fallback, and a stored-enabled widget serving `enabled: false` once `contactPhone` is cleared while the stored block stays untouched. Verify with `npx tsx scripts/verify-chat-widget.ts`.
- [x] 3.2 Normalise the stored Json before comparing in the script — `jsonb` does not preserve object key order, so a deep-equal against a literal will fail spuriously.

## 4. Storefront — footer layout

- [x] 4.1 Move the social icon row out of the bottom bar in `nextjs/src/components/layout/Footer.tsx` and render it beneath `aboutText` inside the brand block, keeping the existing `SOCIAL_ICONS` lookup, the unknown-platform skip and `FOCUS_ON_BRAND`. Verify the icons render under the about text and the store's configured links still open.
- [x] 4.2 Add the agency credit constant and its logo asset (module-level constant in `nextjs/`, asset under `public/`), with a comment recording design.md Decision 1 — that it is the builder's credit, deliberately not merchant-editable, and changing it is a code change.
- [x] 4.3 Rebuild the bottom bar as two halves: `Copyright © <year> | <brandName>` on the left using the same composed `storeName + siteNameAccent` the brand slot uses, and `Design & Developed by <logo linking to the agency URL>` on the right. Keep the existing `sm:flex-row` stacking so both halves centre on phones. Verify at phone and desktop widths that neither half wraps awkwardly and the logo link opens the agency site.
- [x] 4.4 Update the Footer component's header comment to describe the new bottom bar, and note that `copyrightText` is no longer rendered (per design.md Decision 3) so nobody restores it as a bug fix.

## 5. Storefront — chat widget

- [x] 5.1 Add the `ChatWidget` type to `nextjs/src/types/store-settings.ts`, mirroring the backend shape, with the usual comment about staying in step with `server/`.
- [x] 5.2 Add `chatWidget` to the mapper in `nextjs/src/services/store-settings.ts` and a `FALLBACK_SETTINGS.chatWidget` that is **disabled**, so an unreachable backend never floats a dead bubble. Verify a settings payload missing the block maps to the disabled fallback.
- [x] 5.3 Create `nextjs/src/components/layout/ChatWidget.tsx` — a server component rendering an `<a target="_blank" rel="noopener noreferrer">` to `https://wa.me/<digits>` or `https://m.me/<username>`, with an `aria-label` naming the channel and the greeting label beside it. Return `null` when disabled or when the channel's destination is missing. Strip non-digits from the number at render. Verify each channel produces the right URL and that a disabled block renders nothing.
- [x] 5.4 Mount `ChatWidget` in `nextjs/src/app/(shop)/layout.tsx` beside `Footer` and `MobileBottomNav`, passing `settings.chatWidget` — no extra fetch. Do **not** mount it in `(landing)`. Verify the bubble appears on a shop route and is absent from `/offer/<slug>`.
- [x] 5.5 Position the bubble fixed bottom-right with a raised bottom offset below `md` so it clears `MobileBottomNav` and the iOS safe-area inset; add a comment recording design.md Decision 6. Verify on a narrow viewport that the bubble does not overlap the bottom nav.

## 6. Admin — chat widget editor

- [x] 6.1 Add the `ChatWidget` type, `CHAT_CHANNELS`, and `SETTINGS_LIMITS` entries mirroring the backend bounds to `admin/src/lib/api/store-settings.ts`. Verify `npm run build --workspace admin` type-checks.
- [x] 6.2 Add a Chat widget `EditorSection` to `admin/src/features/ui/footer-links/footer-links-page.tsx` following the existing `useSettingsDraft` pattern: enabled switch, channel radio group, WhatsApp number input, Messenger username input, greeting input — showing only the selected channel's destination field. Verify the unsaved-changes bar appears on edit and clears after save.
- [x] 6.3 Extend the page's draft to write **only** the `chatWidget` key in addition to its existing set, keeping it disjoint from every other settings editor; verify saving Chat widget does not clear another editor's values.
- [x] 6.4 Show the resolved destination under the field and warn when the widget is enabled but the destination resolves to nothing — the read-time disable is otherwise invisible until the merchant looks at the storefront (design.md, Risks). Verify the warning appears when the number is blank and `contactPhone` is empty.
- [x] 6.5 Update the page's header comment to record that it now also owns `chatWidget`, keeping the disjoint-field-set note accurate.

## 7. Admin — preview parity

- [x] 7.1 Update `FooterPreview` in the same file so its social icons sit under the brand/about block and its bottom bar shows `Copyright © <year> | <store name>` on the left and the agency credit on the right, matching the storefront. Verify the preview and a running storefront show the same arrangement.
- [x] 7.2 Add help text to the `copyrightText` field wherever it is still edited, stating the footer now renders the store name (design.md Decision 3) so the field's apparent no-op is explained rather than filed as a bug.

## 8. Final verification

- [x] 8.1 Run `npx tsx scripts/verify-chat-widget.ts` and `npx tsx scripts/verify-revalidate-tags.ts`; both pass.
- [x] 8.2 Run `npm run lint --workspace server`, `npm run lint --workspace admin`, `npm run lint --workspace nextjs` and `npm run test --workspace nextjs`; all pass. (Build commands are the user's to run.)
- [ ] 8.3 (MANUAL — needs the apps running, left for the user) Walk the merchant path end to end: with only `contactPhone` set, enable the widget on the WhatsApp channel and confirm the storefront bubble opens a conversation with that number; then set an explicit `whatsappNumber` and confirm it overrides.
