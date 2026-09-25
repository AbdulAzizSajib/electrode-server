## Purpose

Outbound operational alerts to a merchant's own Telegram chat — which events announce themselves, what a
message may carry, how the bot credentials are stored and verified, and the standing rule that a failure
to deliver an alert never becomes a failure of the thing being announced.

## ADDED Requirements

### Requirement: Telegram is configured as an integration, with the bot token write-only and the chat id readable

The system SHALL expose Telegram in the integration registry under the id `TELEGRAM`, categorised as a
notification integration rather than a courier or a marketing one, holding exactly two credentials: a bot
token and a chat id.

The bot token SHALL be treated as a secret — stored encrypted, never returned by any endpoint, and
disclosed only as a masked hint. The chat id SHALL NOT be treated as a secret and SHALL be returned in
full, because a merchant must be able to confirm which chat is wired up and the value is inert without
the token.

Only OWNER and ADMIN SHALL be able to read or change this configuration, consistent with every other
integration.

#### Scenario: Merchant saves both credentials

- **WHEN** an OWNER submits a bot token and a chat id
- **THEN** both are stored, and the integration reports itself configured

#### Scenario: Reading the integration back

- **WHEN** an OWNER lists integrations after saving
- **THEN** the bot token is represented only by a masked hint, and the chat id is returned as the literal
  value that was saved

#### Scenario: Staff attempts to configure it

- **WHEN** a user whose role is STAFF requests or updates the Telegram integration
- **THEN** the request is refused on role grounds, and nothing is read or written

#### Scenario: Only one credential supplied

- **WHEN** a bot token is saved but no chat id has ever been saved
- **THEN** the integration reports itself not configured, and no event dispatches a message

### Requirement: The merchant can verify the connection with an explicit test send

The system SHALL provide an OWNER/ADMIN action that sends a fixed test message to the currently saved
chat and reports the outcome synchronously.

On failure the response SHALL carry the reason as reported by Telegram rather than a generic message,
because the three common setup mistakes — a wrong chat id, a revoked token, and a bot that was never
added to the target group — are indistinguishable to the merchant otherwise.

This action is the ONLY place in this capability where a delivery failure is surfaced to a caller. It
exists because the chat id is typed by hand: without an explicit verification step, the first evidence of
a mistyped id is a missed order at an unknown later date.

#### Scenario: Test send against a correct configuration

- **WHEN** an OWNER triggers the test action with a valid token and a chat the bot can post to
- **THEN** a message arrives in that chat and the response reports success

#### Scenario: Test send against a wrong chat id

- **WHEN** the saved chat id does not name a chat the bot can post to
- **THEN** the response reports failure and includes the description Telegram returned

#### Scenario: Test send before configuring

- **WHEN** the test action is triggered while the token or the chat id is missing
- **THEN** the request is refused with a message naming what is missing, and no outbound call is made

### Requirement: Four operational events dispatch a Telegram message

When the integration is enabled and configured, the system SHALL send a message to the configured chat on
each of: a new order being placed, an order being cancelled, a product crossing its low-stock threshold,
and a new support ticket being opened.

These dispatches SHALL be additional to the existing in-app notifications, never a replacement for them.
The in-app notification remains the durable record; the Telegram message is an alert on top of it.

#### Scenario: Order placed through normal checkout

- **WHEN** a customer completes checkout
- **THEN** a message describing the order is sent to the configured chat, and the staff in-app
  notification is still written

#### Scenario: Order placed through a landing page

- **WHEN** an order is placed through a campaign landing page's order form
- **THEN** the same message is sent, because a landing-page order is an order placed through the same
  path

#### Scenario: Order cancelled

- **WHEN** an order moves to cancelled
- **THEN** a message naming the order and its new state is sent

#### Scenario: Stock crosses the low threshold

- **WHEN** a product's available stock falls to or below its configured threshold
- **THEN** a message naming the product and the remaining quantity is sent

#### Scenario: Support ticket opened

- **WHEN** a customer opens a support ticket
- **THEN** a message naming the ticket and its subject is sent

### Requirement: A Telegram delivery failure never fails the action that triggered it

Dispatch SHALL be fire-and-forget. The triggering operation — the order write, the stock adjustment, the
ticket creation — SHALL commit and respond without waiting for Telegram, and SHALL NOT observe a
dispatch failure.

There SHALL be no retry and no queue. A message that fails to send is lost, and the in-app notification
is what makes that acceptable.

Every outbound call SHALL carry a timeout, so that an unresponsive Telegram cannot hold a connection or a
process open indefinitely.

#### Scenario: Telegram is unreachable during checkout

- **WHEN** an order is placed while `api.telegram.org` cannot be reached
- **THEN** the order is created and returned to the customer normally, and the failure is logged and
  otherwise ignored

#### Scenario: Telegram rejects the message

- **WHEN** Telegram answers a dispatch with an error
- **THEN** the error is logged, no retry is attempted, and the triggering operation is unaffected

#### Scenario: Telegram is slow

- **WHEN** Telegram does not answer within the configured timeout
- **THEN** the call is abandoned and the triggering operation is unaffected

### Requirement: A disabled, unconfigured or unreadable integration sends nothing and reports nothing

When the Telegram integration is switched off, when either credential is absent, or when a stored
credential cannot be decrypted, the system SHALL make no outbound call and SHALL NOT treat the absence as
an error.

A shop that has never connected Telegram must generate no error output from these four events. An
integration nobody configured is not a fault, and logging it as one trains operators to ignore the log.

#### Scenario: Integration switched off

- **WHEN** an order is placed while the Telegram integration is disabled
- **THEN** no outbound call is made, and nothing is logged as an error

#### Scenario: Never configured

- **WHEN** an order is placed on a shop that has never saved Telegram credentials
- **THEN** no outbound call is made, and nothing is logged as an error

#### Scenario: Credential cannot be decrypted

- **WHEN** a stored bot token cannot be decrypted
- **THEN** no outbound call is made, the integration reports itself unreadable to the admin, and the
  order is unaffected

### Requirement: A new-order message carries what staff need to act on it without opening the panel

The new-order message SHALL carry the order number, the order total, the payment method, the ordered
items, the customer's name, the customer's phone number, the customer's delivery address, and a link to
the order in the admin panel.

The phone number is required content, not optional detail: in a cash-on-delivery shop the first action on
a new order is a confirmation call, and a message that omits the number has not saved the trip to the
panel that it exists to save.

This SHALL be understood to publish customer personal information to a third party. The admin surface
SHALL state this where the merchant configures the integration, so that the requirement to keep the
destination chat private and staff-only is a stated condition of use rather than an assumption.

#### Scenario: A new order message is composed

- **WHEN** an order is placed with two items, for a named customer with a phone number and an address
- **THEN** the message contains the order number, the total, the payment method, both item lines, the
  customer's name, phone and address, and a link to that order in the admin panel

#### Scenario: A field is absent on the order

- **WHEN** an order carries no value for a field the message would show
- **THEN** that line is omitted and the rest of the message is sent unchanged

### Requirement: Message text is escaped and bounded so that content can never prevent delivery

Message text SHALL be formatted with a markup mode whose escaping rules can be satisfied for arbitrary
customer-supplied content, and every interpolated value SHALL be escaped before it is sent.

No customer-supplied value — a name, an address, a product title, a ticket subject — may cause a message
to be rejected. A rejected message is indistinguishable from an outage at the receiving end, and it fails
precisely for the orders whose data is unusual.

Message text SHALL be truncated to the maximum length the Telegram API accepts, so that a large order
degrades to a shortened message rather than to no message.

#### Scenario: Customer data contains markup characters

- **WHEN** an order's address or a product title contains characters that are significant to the markup
  mode in use
- **THEN** they are escaped, the message is accepted by Telegram, and the text displays the original
  characters

#### Scenario: Order exceeds the message length limit

- **WHEN** an order has enough items that the composed message would exceed the API's maximum length
- **THEN** the text is truncated to fit and sent, rather than being rejected or dropped

#### Scenario: Phone numbers and hyphenated addresses

- **WHEN** a message carries a phone number or an address containing hyphens, dots or other punctuation
- **THEN** the message is delivered with those values intact
