## Purpose

Hands packed orders to Steadfast Courier as consignments and keeps their delivery state visible inside the admin panel, so fulfilment at volume is a selection and one action rather than an address re-typed into someone else's portal.

## ADDED Requirements

### Requirement: Courier credentials come from the environment and their absence is stated
The API key and secret SHALL be read from the environment (`STEADFAST_API_KEY`, `STEADFAST_SECRET_KEY`) and SHALL NOT be stored in `StoreSetting` or returned by any endpoint. When either is missing, courier endpoints SHALL fail with a clear configuration error rather than attempting an unauthenticated call.

Store settings are served publicly; a credential kept there is one careless field selection away from being published.

#### Scenario: Dispatch attempted without credentials configured
- **WHEN** staff dispatch an order and `STEADFAST_API_KEY` or `STEADFAST_SECRET_KEY` is unset
- **THEN** the request fails with a message naming the missing configuration, and no call is made to Steadfast

#### Scenario: Credentials are never disclosed
- **WHEN** any courier or settings endpoint returns a response
- **THEN** the response contains neither the API key nor the secret key

### Requirement: Only packed orders may be dispatched
An order SHALL be eligible for dispatch only while its status is `PACKED`. An order in any other status SHALL be reported as ineligible with its current status as the reason.

The parcel must physically exist before a courier is told to collect it, and this matches the established pick → box → label sequence.

#### Scenario: A packed order is eligible
- **WHEN** staff select an order with status `PACKED` for dispatch
- **THEN** it is accepted for dispatch

#### Scenario: An unpacked order is refused
- **WHEN** staff select an order with status `CONFIRMED`, `PROCESSING`, `PENDING`, `SHIPPED`, `DELIVERED`, `CANCELLED` or `COMPLETED`
- **THEN** that order is reported ineligible, naming its current status, and is not sent to Steadfast

### Requirement: An order is dispatched to the courier at most once
An order that already carries a consignment SHALL NOT be dispatched again. A repeat attempt SHALL be reported as already dispatched and SHALL return the existing consignment identity rather than creating a second one.

A duplicate consignment is a second courier pickup for a parcel that does not exist, billed to the merchant.

#### Scenario: Re-dispatching an already dispatched order
- **WHEN** staff include an order that already has a `consignmentId` in a dispatch selection
- **THEN** no new consignment is created and the order is reported as already dispatched, carrying its existing consignment id and tracking code

#### Scenario: The same order appears twice in one selection
- **WHEN** a dispatch request contains the same order id more than once
- **THEN** it is dispatched at most once

### Requirement: Orders are validated before any courier call
Every selected order SHALL be checked against the courier's field constraints before the batch is sent. An order failing any check SHALL be excluded and reported with a specific, human-readable reason. Eligible orders in the same selection SHALL still be dispatched.

Discovering an unusable address halfway through a batch leaves the operator unable to tell which parcels were accepted.

#### Scenario: An order with an unusable phone number is excluded
- **WHEN** a selected order's recipient phone cannot be expressed as a Bangladeshi 11-digit mobile number
- **THEN** that order is excluded and reported with that reason, and the remaining selected orders are dispatched

#### Scenario: An over-length address is refused, not truncated
- **WHEN** a selected order's composed recipient address exceeds the courier's 250-character limit
- **THEN** that order is excluded and reported, and its address is NOT shortened to fit

#### Scenario: A mixed selection dispatches the valid remainder
- **WHEN** staff dispatch twenty orders of which two fail validation
- **THEN** eighteen consignments are created and the response names the two that were not, with reasons

### Requirement: Order data maps to consignment fields on fixed rules
Each dispatched order SHALL map to a consignment as follows: `invoice` is the order's `orderNumber`; `recipient_name` is the shipping address's full name, falling back to the customer's name; `recipient_phone` is the recipient's number in 11-digit local form; `recipient_address` is the shipping address composed into a single line; and `cod_amount` is the order's outstanding balance — its total less payments already recorded as paid — which SHALL be `0` for a fully prepaid order.

`orderNumber` is already unique and is already what the parcel's printed barcode encodes, so it is the one value that ties a physical parcel, an admin record and a consignment together. Phone numbers are stored canonically as E.164 and must be converted, since the courier accepts only the local form.

#### Scenario: A COD order carries the amount still owed
- **WHEN** an order totalling 3,500 with no recorded payment is dispatched
- **THEN** the consignment's `cod_amount` is 3,500

#### Scenario: A prepaid order collects nothing
- **WHEN** an order whose payments already cover its total is dispatched
- **THEN** the consignment's `cod_amount` is 0

#### Scenario: A stored phone number is converted to local form
- **WHEN** an order whose recipient phone is stored as `+8801712345678` is dispatched
- **THEN** the consignment's `recipient_phone` is `01712345678`

### Requirement: Every consignment is created as a home delivery
Dispatch SHALL request the courier's default home delivery for every consignment and SHALL NOT offer a per-order delivery type.

The courier's bulk endpoint accepts no delivery-type field, so supporting point delivery would mean abandoning bulk dispatch and issuing one request per parcel.

#### Scenario: No delivery type is selectable
- **WHEN** staff dispatch any selection of orders
- **THEN** no delivery-type choice is offered and every resulting consignment is a home delivery

### Requirement: Bulk dispatch records each order's outcome independently
Dispatch SHALL send orders to the courier in bounded batches and SHALL record the result of each order separately. Results SHALL be matched back to orders by `invoice`, never by position in the response. A failure for one order SHALL NOT discard or reverse a consignment successfully created for another.

The courier's bulk response mixes successes and failures in one array; a consignment it reports as created exists in the courier's system whatever happens to the rest of the batch.

#### Scenario: A partially successful batch persists its successes
- **WHEN** a batch of fifty orders returns forty-seven successes and three errors
- **THEN** forty-seven shipments are recorded with their consignment identities and the three failures are reported as retryable, with nothing rolled back

#### Scenario: Results are matched by invoice
- **WHEN** the courier returns batch results in an order different from the one sent
- **THEN** each result is applied to the order whose `orderNumber` matches its `invoice`

#### Scenario: A large selection is split into batches
- **WHEN** staff dispatch more orders than one courier request may carry
- **THEN** the orders are sent as several bounded batches and reported as one combined result

### Requirement: A dispatch whose outcome is unknown is never reported as a failure
When a courier call times out or its response cannot be read, the affected orders SHALL be reported as unconfirmed — not as failed — and SHALL NOT be presented as safe to retry until their true state has been established by querying the courier.

The courier continues processing a request whose response was never received, so a retry after an apparent failure is how one parcel becomes two consignments.

#### Scenario: A dispatch batch times out
- **WHEN** a courier request exceeds its timeout
- **THEN** the orders in that batch are reported as unconfirmed with an instruction to check before retrying, and are not marked as failed

### Requirement: A successful dispatch records the consignment and advances the order
On a successful dispatch the system SHALL record the courier's consignment id, tracking code and the invoice sent, mark the shipment's carrier as Steadfast, and move the order's status to `SHIPPED`. The action SHALL be attributed to the staff member who performed it.

#### Scenario: Consignment identity is stored
- **WHEN** the courier accepts an order and returns a consignment id and tracking code
- **THEN** the order's shipment records both, together with the invoice that was sent and the carrier

#### Scenario: The order moves to shipped
- **WHEN** an order is successfully dispatched
- **THEN** its status becomes `SHIPPED` and the transition is recorded in the order's status history

#### Scenario: Dispatch is attributable
- **WHEN** staff dispatch any selection of orders
- **THEN** an audit record identifies who dispatched which orders and when

### Requirement: Delivery status arrives by webhook
The system SHALL accept the courier's delivery-status and tracking notifications at a dedicated endpoint, match each to a consignment by its consignment id, and record the reported status together with the time it was received. A notification naming a consignment the system does not hold SHALL be acknowledged and ignored rather than treated as an error.

Status comparison SHALL be case-insensitive: the courier's own documentation lists lowercase values while its example payload sends `Delivered`.

#### Scenario: A delivery-status notification updates the consignment
- **WHEN** the courier posts a `delivery_status` notification for a known consignment
- **THEN** the reported status is recorded against that consignment with the time it was received

#### Scenario: Status casing does not matter
- **WHEN** a notification reports `Delivered` rather than `delivered`
- **THEN** it is treated as the delivered state

#### Scenario: An unknown consignment is acknowledged, not failed
- **WHEN** a notification names a consignment id the system does not hold
- **THEN** the request is acknowledged successfully and nothing is recorded

#### Scenario: A repeated notification changes nothing
- **WHEN** the courier delivers the same notification more than once
- **THEN** the consignment's state is unchanged by the repeat and no duplicate history entry is stored

### Requirement: The webhook endpoint authenticates the courier
The webhook endpoint SHALL require the bearer token configured with the courier and SHALL reject any request without it. The comparison SHALL NOT leak timing information. The endpoint SHALL reject requests when no token is configured, rather than accepting them unauthenticated.

This endpoint is necessarily outside the session-based authentication every other courier route uses, so the token is its entire boundary.

#### Scenario: A request without the token is refused
- **WHEN** the webhook endpoint is called without the configured bearer token
- **THEN** the request is rejected and nothing is recorded

#### Scenario: No token configured means no access
- **WHEN** the webhook endpoint is called while no webhook token is configured
- **THEN** the request is rejected rather than accepted

### Requirement: Tracking notifications are kept as history
Every notification the courier sends about a consignment SHALL be appended to that consignment's tracking history, retaining the courier's message, its reported status where present, and the courier's own timestamp. History SHALL NOT be reduced to a latest value.

"Where has this parcel been" is the question a late delivery actually raises, and only a sequence can answer it.

#### Scenario: Successive tracking updates accumulate
- **WHEN** the courier sends three tracking updates for one consignment
- **THEN** all three are retained in order, each with its message and timestamp

#### Scenario: Delivery-status changes appear in the same history
- **WHEN** a consignment receives both tracking updates and delivery-status changes
- **THEN** both appear in one interleaved history for that consignment

#### Scenario: A replayed notification does not duplicate history
- **WHEN** the courier re-delivers a notification already recorded
- **THEN** no second history entry is created

### Requirement: Consignments that have gone quiet are reconciled on a schedule
The system SHALL periodically query the courier for consignments that are not in a terminal state and have not been heard from recently, and SHALL record what it finds. Terminal consignments SHALL NOT be re-queried.

A webhook is one delivery attempt against an endpoint that will sometimes be mid-deploy or briefly unreachable, and a missed one is otherwise undetectable — the order simply sits shipped forever. This job looks for that silence.

#### Scenario: A consignment with no recent notification is polled
- **WHEN** reconciliation runs and a non-terminal consignment has not been heard from within the staleness window
- **THEN** the courier is queried for it and the returned status and observation time are recorded

#### Scenario: A recently updated consignment is left alone
- **WHEN** reconciliation runs and a consignment received a notification inside the staleness window
- **THEN** it is not queried

#### Scenario: A settled consignment is left alone
- **WHEN** reconciliation runs and a consignment is already delivered or cancelled
- **THEN** it is not queried

#### Scenario: A courier outage does not corrupt state
- **WHEN** the courier is unreachable during reconciliation
- **THEN** existing statuses are left unchanged and the failure is recorded rather than surfaced as a delivery state

### Requirement: Both status paths apply a status identically
A status arriving by webhook and the same status arriving by reconciliation SHALL have identical effect on the shipment and its order. Applying a status the consignment already holds SHALL change nothing.

Two paths writing the same state by different rules is how a panel comes to disagree with itself.

#### Scenario: The same status from either path has the same effect
- **WHEN** a consignment becomes delivered, whether reported by webhook or discovered by reconciliation
- **THEN** the resulting shipment and order state are the same

#### Scenario: Re-applying a held status is inert
- **WHEN** a status equal to the consignment's current status is applied
- **THEN** nothing about the shipment or its order changes

### Requirement: The reconciliation endpoint is not publicly callable
The scheduled reconciliation SHALL be reachable only by the scheduler, authenticated by a shared secret, and SHALL reject an unauthenticated request.

#### Scenario: An unauthenticated reconciliation request is refused
- **WHEN** the reconciliation endpoint is called without the correct secret
- **THEN** the request is rejected and no courier calls are made

### Requirement: A courier delivery is reflected in the order
When the courier reports a consignment as delivered, the system SHALL mark the shipment delivered, record the delivery time, and advance the order to `DELIVERED`.

#### Scenario: Delivery propagates to the order
- **WHEN** a consignment's status becomes `delivered`, by either webhook or reconciliation
- **THEN** the shipment is marked delivered with a delivery timestamp and the order's status becomes `DELIVERED`

### Requirement: A courier cancellation is flagged and never restocks automatically
When the courier reports a consignment as cancelled or returned, the system SHALL record that state and surface the order as needing attention. It SHALL NOT change the order's status, return stock, or issue a refund on its own.

A cancellation at the courier means the parcel is on its way back, not that it has arrived. Returning stock before it is physically in hand advertises goods the shop does not have.

#### Scenario: A cancelled consignment is surfaced, not resolved
- **WHEN** a consignment's status becomes `cancelled`, by either webhook or reconciliation
- **THEN** the shipment records the cancellation and the order is listed as needing attention, with its status and stock unchanged

#### Scenario: Staff resolve the cancellation themselves
- **WHEN** staff act on an order flagged for a courier cancellation
- **THEN** the existing order-cancellation and restocking paths apply, unchanged by this capability

### Requirement: Staff can read the courier account balance
Staff SHALL be able to retrieve the current Steadfast account balance.

#### Scenario: Balance is retrieved
- **WHEN** staff request the courier balance
- **THEN** the current balance reported by the courier is returned

### Requirement: Staff can raise a courier return request
Staff SHALL be able to request a return for a dispatched consignment, optionally with a reason, and the request's identifier and status SHALL be recorded against the order.

#### Scenario: A return is requested for a dispatched order
- **WHEN** staff raise a courier return for an order carrying a consignment, with a reason
- **THEN** the courier records the request and its identifier and status are stored against the order

#### Scenario: A return cannot be raised for an undispatched order
- **WHEN** staff attempt a courier return for an order with no consignment
- **THEN** the request is refused, naming the absence of a consignment

### Requirement: Courier access is limited to staff roles
Every courier endpoint SHALL require an authenticated session in the `OWNER`, `ADMIN` or `STAFF` role. A customer session SHALL be refused.

#### Scenario: A customer cannot dispatch orders
- **WHEN** a request to any courier endpoint carries a `CUSTOMER` session
- **THEN** the response is 403
