## 1. Registry and types

- [x] 1.1 Add `BOT_TOKEN: "botToken"` and `CHAT_ID: "chatId"` to `CredentialKind` in `server/src/app/module/integration/integration.constant.ts`. These strings are permanent storage keys — verify they read exactly `botToken` and `chatId`, and that `tsc` passes.
- [x] 1.2 Widen `IntegrationCategory` in `server/src/app/module/integration/integration.interface.ts` to `"COURIER" | "MARKETING" | "NOTIFICATION"`, with a comment recording why an operational alert is not filed under Marketing (design Decision 2); verify `npx tsc --noEmit` surfaces every place that switches on category, and that each is handled.
- [x] 1.3 Add `TELEGRAM` to `IntegrationId` and an entry to `INTEGRATIONS` declaring `botToken` (`secret: true`) and `chatId` (`secret: false`), each with a placeholder naming where the merchant finds it, plus a comment citing design Decision 3 for why the chat id is a non-secret credential rather than `StoreSetting.integrationConfig`; verify `GET /api/v1/integrations` as OWNER returns a `TELEGRAM` entry with `configured: false` and `category: "NOTIFICATION"`.
- [ ] 1.4 Verify the write-only/readable split end to end: save both credentials through `PUT /integrations/TELEGRAM/credentials`, then re-read `GET /integrations` and confirm the bot token appears only as a masked hint while the chat id comes back as the literal value that was saved.
- [ ] 1.5 Verify a STAFF token is refused on `GET /integrations` and on the credential write, and that an unauthenticated request is refused — the existing route guards should cover this with no new code.

## 2. Telegram sender

- [x] 2.1 Create `server/src/app/module/integration/telegram.ts` modelled on `facebook-capi.ts`, with a module header comment recording the fire-and-forget posture and pointing at design Decisions 6 and 8; verify it exports a void-returning send function and imports nothing from `express`.
- [x] 2.2 Implement `escapeHtml` covering exactly `&`, `<` and `>`, applied to every interpolated value; verify a value containing `<script>` and `Ma & Co` round-trips into a delivered message showing the original characters.
- [x] 2.3 Implement the dispatch guard in the order design Decision 8 requires: resolve credentials FIRST and return silently unless both `botToken` and `chatId` are present, then check `IntegrationService.isEnabled`. Add an inline comment stating that `isEnabled` returns `true` for an integration with no row, so it cannot be the first gate. Verify against a database with no `Integration` row for `TELEGRAM` that placing an order produces no outbound call and no log output.
- [x] 2.4 POST to `https://api.telegram.org/bot<token>/sendMessage` with `chat_id`, `text` and `parse_mode: "HTML"`, under `AbortSignal.timeout(TIMEOUT_MS)` with the same 3000 ms budget `facebook-capi.ts` uses; verify with a stubbed slow endpoint that the call is abandoned at the timeout and the caller is unaffected.
- [x] 2.5 Truncate composed text to the 4096-character API maximum before sending; verify an order with enough items to exceed it still delivers a shortened message rather than being rejected.
- [x] 2.6 Ensure every failure path — network error, timeout, non-2xx from Telegram, `ok: false` in the body — is logged once and swallowed; verify the function never rejects by calling it with a deliberately invalid token and confirming no unhandled rejection.

## 3. Message builders

- [x] 3.1 Build the new-order message carrying order number, total, payment method, item lines, customer name, phone, delivery address and a link to the order in the admin panel; verify against a seeded order that every one of those appears and the link resolves to that order.
- [x] 3.2 Omit any line whose underlying value is absent rather than printing an empty label; verify with an order missing an optional field that the message is sent and that line is gone.
- [x] 3.3 Build the order-cancelled message (order number, previous and new state, total); verify it is sent on a cancellation and names the right order.
- [x] 3.4 Build the low-stock message (product name, variant where relevant, remaining quantity, threshold); verify it matches what the existing in-app low-stock notification reports for the same event.
- [x] 3.5 Build the new-support-ticket message (ticket reference, subject, customer name); verify it is sent when a ticket is opened.
- [x] 3.6 Verify every builder escapes through the helper from 2.2 — grep the file and confirm no interpolated database value reaches the template unescaped.

## 4. Dispatch points

- [x] 4.1 Add the new-order dispatch in `server/src/app/module/order/order.service.ts` immediately beside the existing `NotificationService.notifyOwnersAndAdmins` call, `void`-called with its own `.catch`, matching the surrounding comment style; verify the in-app staff notification is still written and the order response time is unchanged.
- [ ] 4.2 Verify the same hook covers landing-page orders with no second call site, by placing an order through a campaign landing page's order form and confirming one message arrives.
- [x] 4.3 Add the cancellation dispatch to **both** cancellation paths — `cancelOwnOrder` (customer self-service) and `updateOrderStatus` (staff), the latter gated on `payload.status === CANCELLED` so the other six lifecycle transitions stay silent. This task originally named one path; there are two, and the spec's "an order moves to cancelled" covers both. Verify cancelling by either route sends exactly one message, and that PROCESSING/SHIPPED/DELIVERED send none.
- [x] 4.4 Add the low-stock dispatch in `server/src/app/module/stock/stock.service.ts` beside its existing `notifyOwnersAndAdmins`; verify it fires when a product crosses its threshold and not on every stock write.
- [x] 4.5 Add the support-ticket dispatch in `createTicket`. This task assumed an existing staff notification to sit beside; there is none — `notifyOtherParticipant` routes MESSAGES on a ticket, and a newly opened ticket has no assignee, so until now opening a ticket notified nobody in the shop. Verify opening a ticket sends one message and that replying to one does not.
- [ ] 4.6 Verify no dispatch is awaited and none can fail its caller: with the Telegram host unreachable, place an order, cancel one, trigger low stock and open a ticket, and confirm all four operations succeed normally with only log output.
- [x] 4.7 Verify no dispatch was added inside an open Prisma transaction — grep each call site's enclosing function and confirm the call sits after the commit, as design Decision 5 requires.

## 5. Test-send endpoint

- [x] 5.1 Add a provider-to-test-handler map and a `testIntegration(provider)` function in a new `integration.test-send.ts` — **not** `integration.service.ts` as this task first said: `telegram.ts` imports `IntegrationService`, so putting it there makes the two modules import each other. Survivable under ESM since every use is inside a function, but a cycle a later edit could turn into a module-init crash, for no benefit. Verify a provider with no handler is refused with 400.
- [x] 5.2 Refuse the test with a message naming what is missing when either credential is absent, before any outbound call; verify by clearing the chat id and confirming the response says so and no request reaches Telegram.
- [x] 5.3 Relay Telegram's own `description` verbatim on failure rather than a generic message; verify with a deliberately wrong chat id that the response carries Telegram's wording.
- [x] 5.4 Add `POST /integrations/:provider/test` to `integration.route.ts` and `integration.controller.ts` behind `checkAuth(RoleName.OWNER, RoleName.ADMIN)`, with a comment on why this endpoint surfaces a delivery failure when nothing else does; verify a STAFF token is refused and an OWNER token gets a result.
- [x] 5.5 Verify a successful test delivers a fixed message to the configured chat and the response reports success.

## 6. API contract and verification

- [ ] 6.1 Add `POST /integrations/:provider/test` to `server/postman/Ecom.postman_collection.json` in the existing Integrations group, matching the field names and response envelope the endpoint actually returns; verify with `cd server && npx tsx scripts/verify-postman-routes.ts` (must pass in both directions).
- [x] 6.2 Write `server/scripts/verify-telegram-notifications.ts` following the `__verify_*` row convention with cleanup in `finally`, asserting: an absent credential produces no outbound call; a credential that fails to decrypt behaves identically to an absent one; the disabled toggle stops a send while credentials are present; HTML escaping survives a value containing `&`, `<` and `>`; and text longer than 4096 characters is truncated rather than dropped. Verify with `npx tsx scripts/verify-telegram-notifications.ts`.
- [x] 6.3 Run the existing integration and courier verify scripts to confirm the category widening and the new registry entry broke nothing: `npx tsx scripts/verify-integration-credentials.ts` and the `verify-courier-*.ts` suite.
- [x] 6.4 Run `npm --prefix server run build` and confirm `prisma generate && tsc && fix-imports` completes clean.

## 7. Admin panel

Implemented in the admin repository. Listed here so the two halves ship together; commit them in `admin/`, not in the server repo.

- [x] 7.1 Add `TELEGRAM` to `INTEGRATION_IDS` and a test-send mutation to `admin/src/lib/api/integrations.ts`, going through the shared `request()` helper so the backend's own error message surfaces; verify a failed test shows Telegram's wording in the toast, not a generic one.
- [x] 7.2 Create `admin/src/features/ui/integrations/telegram-card.tsx` using the existing descriptor-driven `CredentialForm` — no new form component, no `antd` import; verify the token renders masked and the chat id renders as a plain readable value.
- [x] 7.3 Add numbered setup instructions to the card in the style of the Steadfast webhook block: create the bot in @BotFather, copy the token, add the bot to a private staff group, obtain the chat id, paste both, send a test. Verify a reader who has never used Telegram can follow them without leaving the page.
- [x] 7.4 State plainly on the card that order alerts include the customer's name, phone and address, and that the destination chat must be private and staff-only; verify the text is visible without expanding anything.
- [x] 7.5 Add a **Send test message** button wired to 7.1, disabled until both credentials are saved, reporting success and failure inline; verify a wrong chat id produces a readable error on the page.
- [x] 7.6 Add a `Notifications` section to `admin/src/features/ui/integrations/integrations-page.tsx` holding the card, registering its own key with `markDirty` so the page-wide unsaved-changes guard covers it; verify navigating away with unsaved edits prompts, and that saving this card does not touch courier or Facebook credentials.
- [x] 7.7 Run `npm --prefix admin run lint` and `npm --prefix admin run test`; verify both pass.

## 8. Operational handover

- [ ] 8.1 Verify outbound HTTPS to `api.telegram.org` is permitted from the target host before the cPanel migration — the same check Facebook CAPI needs; confirm with a request from the server itself, not from a developer machine.
- [ ] 8.2 Confirm `INTEGRATION_ENCRYPTION_KEY` is set on every environment this deploys to, and verify that a shop without it reports the Telegram integration as unreadable rather than unconfigured after a token is saved.
- [ ] 8.3 Verify the untouched path: on a shop that never configures Telegram, place an order, cancel one, trigger low stock and open a ticket, and confirm all four complete with no outbound call and no error-level log output.
