## Why

A merchant running this shop learns that an order arrived only by looking at the admin panel. The
in-app `Notification` rows written on checkout are real and correct, but they are visible exactly where
the merchant already is — at the desk, with the panel open. Away from it, nothing reaches them.

For a COD-first shop that is not a convenience problem. The first thing staff do with a new order is
phone the customer to confirm it, because an unconfirmed COD parcel is a parcel that gets refused at the
door and comes back at the shop's cost. Every hour between "order placed" and "someone called" is a
measurable loss, and right now that gap is bounded by how often someone thinks to refresh a browser tab.

Telegram closes it for nothing. A bot created in @BotFather posts into a private staff group over plain
HTTPS — no per-message cost like SMS, no app for staff to install beyond one they likely already have,
and a push notification that arrives whether or not anyone is at a computer. The integration surface
this needs already exists: `integration.constant.ts` is a declarative registry, the admin renders
credential forms from what it declares, and the four events worth announcing already have
`NotificationService` calls sitting at exactly the right line.

## What Changes

**A new integration, declared rather than built**

- New `TELEGRAM` entry in the `INTEGRATIONS` registry with two credentials: `botToken` (secret, masked,
  write-only) and `chatId` (**not** secret — it is an identifier the merchant must be able to read back
  to confirm which chat is wired up, and it is worthless to anyone without the token).
- New `CredentialKind` values `BOT_TOKEN` and `CHAT_ID`. Kinds are permanent storage keys; these are
  added, never renamed later.
- **New `IntegrationCategory` value `"NOTIFICATION"`.** The type is currently `"COURIER" | "MARKETING"`
  and Telegram is neither — filing it under Marketing would put an operational alert in the same group
  as ad measurement, which is where a merchant would stop looking for it.

**chat_id is pasted, not detected**

- The merchant obtains the chat id themselves (from `@userinfobot`, or by adding the bot to a group)
  and types it into the card. The server does **not** call `getUpdates`.
- This is a deliberate scope decision with a real cost, recorded in design.md: auto-detection is the
  friendlier flow, but it needs an endpoint that long-polls Telegram, it conflicts with any webhook the
  bot has registered, and it only works within 24 hours of the merchant messaging the bot. Manual entry
  has none of those failure modes and one weakness — a typo produces silence.
- That weakness is answered by a **"Send test message" action**, not by detection. `POST
  /integrations/TELEGRAM/test` sends a fixed message to the saved chat and returns Telegram's own error
  verbatim on failure, so a wrong id, a revoked token or a bot that was never added to the group is
  discovered while the merchant is still on the page. Without this the first sign of a bad chat id is a
  missed order weeks later.

**Four events dispatch to Telegram**

Each hook sits beside an existing `NotificationService` call and never replaces it — the in-app
notification remains the durable record, and Telegram is the alert on top of it.

- New order — `order.service.ts`, beside the existing `notifyOwnersAndAdmins`. This one hook covers
  normal checkout **and** landing-page campaign orders, because `LandingPageService` routes through the
  same `OrderService.placeOrder`.
- Order cancelled — the cancellation path's existing `createNotification`.
- Low stock — `stock.service.ts`, beside its existing `notifyOwnersAndAdmins`.
- New support ticket — `support-ticket.service.ts`, beside its existing staff notification.

**Message content**

- The new-order message carries order number, total, payment method, item lines, and the **customer's
  name, phone and address** — because the phone number is what makes the notification actionable for a
  COD shop, and a notification that forces a trip to the panel to find it has saved nothing.
- This publishes customer PII to a third party. The change does not pretend otherwise: the admin card
  states it plainly and the operational requirement is that the destination chat is private and
  staff-only. Recorded in design.md as an accepted trade, not an oversight.
- `parse_mode: "HTML"`, never `MarkdownV2`. MarkdownV2 requires escaping eighteen characters including
  `.` and `-`; a Bangladeshi phone number or a hyphenated Bangla address would silently 400 and the
  message would never arrive. HTML needs three characters escaped.

**Delivery posture**

- Every dispatch is fire-and-forget: not awaited, own errors swallowed and logged, never able to fail
  the order, the stock write or the ticket. There is no retry and no queue — a failed send is lost, and
  the in-app notification is what makes that acceptable.
- A disabled integration, an absent token and an unreadable credential all mean the same thing: no
  send, no error, no log noise.

**Admin**

- A new **Notifications** section on UI → Integrations holding the Telegram card. The credential form is
  generated from the descriptor, so no new form component is written — the card adds setup instructions
  and the Test button.

## Capabilities

### New Capabilities

- `api/telegram-notifications`: Outbound operational alerts to a merchant's Telegram chat — which events
  dispatch, what a message may and may not contain, how the bot credentials are stored and verified, and
  the rule that a delivery failure is never allowed to become an operational failure.

### Modified Capabilities

<!-- None. `api/support-and-admin` specifies that lifecycle events create per-user in-app
     Notifications; this change adds an outbound channel alongside that and alters none of its
     requirements — the rows are still written, still per-user, still the durable record.
     The `integrations` capability from rename-courier-setting-to-integrations was never promoted
     into openspec/specs/, so the registry rules this change extends are restated in the new
     capability rather than deltaed against a spec that does not exist. -->

(none)

## Impact

**Server**

- `src/app/module/integration/` — `integration.constant.ts` (registry entry, two new kinds),
  `integration.interface.ts` (`"NOTIFICATION"` category), `integration.route.ts` +
  `.controller.ts` + `.service.ts` + `.validation.ts` (the test-send endpoint). New
  `telegram.ts` alongside `facebook-capi.ts`, same shape: resolves credentials, checks enabled,
  `fetch` with `AbortSignal.timeout`, swallows its own failures.
- `src/app/module/order/order.service.ts`, `stock/stock.service.ts`,
  `support-ticket/support-ticket.service.ts` — one non-awaited call added at each existing
  notification point. No logic moved, no signatures changed.
- No schema change. `Integration` and `IntegrationCredential` already store an arbitrary provider and
  an arbitrary set of kinds, which is what that design bought.
- New `scripts/verify-telegram-notifications.ts` (live-DB, like its siblings) covering credential
  resolution, the disabled path and HTML escaping.

**API contract**

- `postman/Ecom.postman_collection.json` gains `POST /integrations/:provider/test`. `GET /integrations`
  gains a `TELEGRAM` entry in its response, which is data rather than a shape change.

**Admin**

- `src/features/ui/integrations/` — a `telegram-card.tsx` and a Notifications section in
  `integrations-page.tsx`. `src/lib/api/integrations.ts` gains the test-send mutation and
  `INTEGRATION_IDS.TELEGRAM`.
- Implemented in the admin repository; this change owns the decisions, and the admin tasks are listed
  here so the two halves ship together rather than drifting.

**Operational**

- `INTEGRATION_ENCRYPTION_KEY` must already be set — it is, since Steadfast and CAPI depend on it. A
  shop without it will save the bot token and then be unable to read it, which the card reports as
  unreadable rather than unconfigured.
- Outbound HTTPS to `api.telegram.org` must be permitted. This is already true on Vercel; it is an open
  question on shared cPanel hosting and must be verified before the move, alongside the same question
  for Facebook CAPI.
- Fire-and-forget dispatch depends on the process surviving past the response. On Vercel that is not
  guaranteed and the existing low-stock and staff notifications already carry the same exposure; a
  persistent Node process removes it.

**Deferred**

- Auto-detection of `chat_id` via `getUpdates`. Worth revisiting if merchant setup proves to be the
  common support ticket; nothing here forecloses it, since the credential is stored under a kind that
  either path writes.
- Batching or digesting during campaign spikes. Telegram's default ceiling is 30 messages per second
  and flood control answers with `retry_after`; a landing-page burst could exceed what is useful to read
  even before it exceeds what is allowed. One message per order is correct at current volume and is the
  thing a digest would later replace.
- Any inbound direction — replying to a message to confirm an order, `/status` commands. That needs a
  webhook, a public endpoint and an authorization story; this change is outbound only.
