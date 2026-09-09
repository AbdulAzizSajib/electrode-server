## MODIFIED Requirements

### Requirement: Courier credentials come from the environment and their absence is stated
Each provider's credentials SHALL be read from the environment and SHALL NOT be stored in `StoreSetting` or returned by any endpoint. When the configured provider's credentials are missing, courier endpoints SHALL fail with a clear configuration error naming that provider, rather than attempting an unauthenticated call.

Store settings are served publicly; a credential kept there is one careless field selection away from being published. The provider *selection* is safe to store there because it names a courier rather than granting access to one.

#### Scenario: Dispatch attempted without credentials configured
- **WHEN** staff dispatch an order and the configured provider's credentials are unset
- **THEN** the request fails with a message naming the provider and the missing configuration, and no courier call is made

#### Scenario: Credentials are never disclosed
- **WHEN** any courier or settings endpoint returns a response
- **THEN** the response contains no provider's API key or secret key

### Requirement: A successful dispatch records the consignment and advances the order
On a successful dispatch the system SHALL record the courier's consignment id, tracking code and the invoice sent, record which provider created the consignment, mark the shipment's carrier as that provider's name, and move the order's status to `SHIPPED`. The action SHALL be attributed to the staff member who performed it.

The provider is recorded per consignment, not read from settings at the time of the query: settings name what the shop dispatches through *now*, while a consignment must remain bound to whichever courier is actually carrying it.

#### Scenario: Consignment identity is stored
- **WHEN** the courier accepts an order and returns a consignment id and tracking code
- **THEN** the order's shipment records both, together with the invoice that was sent, the carrier, and the provider that created it

#### Scenario: The order moves to shipped
- **WHEN** an order is successfully dispatched
- **THEN** its status becomes `SHIPPED` and the transition is recorded in the order's status history

#### Scenario: Dispatch is attributable
- **WHEN** staff dispatch any selection of orders
- **THEN** an audit record identifies who dispatched which orders, through which provider, and when

### Requirement: Order data maps to consignment fields on fixed rules
Each dispatched order SHALL map to the configured provider's consignment format. For every provider, `invoice` SHALL be the order's `orderNumber` and the collectable amount SHALL be the order's outstanding balance — its total less payments already recorded as paid — which SHALL be `0` for a fully prepaid order. Field limits, phone formatting and address composition SHALL follow the configured provider's own constraints, and an order that cannot satisfy them SHALL be reported with a provider-specific reason rather than silently adjusted to fit.

`orderNumber` is already unique and is already what the parcel's printed barcode encodes, so it is the one value that ties a physical parcel, an admin record and a consignment together — and it is provider-independent. Everything else differs by courier: phone numbers are stored canonically as E.164 and each courier accepts its own form, and address limits differ.

#### Scenario: A COD order carries the amount still owed
- **WHEN** an order totalling 3,500 with no recorded payment is dispatched
- **THEN** the consignment's collectable amount is 3,500

#### Scenario: A prepaid order collects nothing
- **WHEN** an order whose payments already cover its total is dispatched
- **THEN** the consignment's collectable amount is 0

#### Scenario: A stored phone number is converted to the provider's form
- **WHEN** an order whose recipient phone is stored as `+8801712345678` is dispatched through a provider expecting 11-digit local numbers
- **THEN** the consignment's recipient phone is `01712345678`

#### Scenario: A value the provider cannot accept is refused, not adjusted
- **WHEN** a selected order carries a value exceeding the configured provider's limit for that field
- **THEN** that order is excluded and reported with a reason naming the provider's limit, and the value is NOT shortened to fit

### Requirement: Delivery status arrives by webhook
The system SHALL accept each provider's delivery-status and tracking notifications at that provider's own endpoint, match each to a consignment by the identifier that provider issued, and record the reported status together with the time it was received. A notification naming a consignment the system does not hold SHALL be acknowledged and ignored rather than treated as an error. A notification matching a consignment created by a *different* provider SHALL be rejected.

Status comparison SHALL be case-insensitive: couriers are inconsistent about casing — Steadfast's own documentation lists lowercase values while its example payload sends `Delivered`.

#### Scenario: A delivery-status notification updates the consignment
- **WHEN** a provider posts a delivery-status notification for a consignment it created
- **THEN** the reported status is recorded against that consignment with the time it was received

#### Scenario: Status casing does not matter
- **WHEN** a notification reports `Delivered` rather than `delivered`
- **THEN** it is treated as the delivered state

#### Scenario: An unknown consignment is acknowledged, not failed
- **WHEN** a notification names a consignment id the system does not hold
- **THEN** the request is acknowledged successfully and nothing is recorded

#### Scenario: A consignment belonging to another provider is not updated
- **WHEN** a notification at one provider's endpoint names a consignment id created by a different provider
- **THEN** the consignment is left unchanged and the mismatch is recorded

#### Scenario: A repeated notification changes nothing
- **WHEN** a provider delivers the same notification more than once
- **THEN** the consignment's state is unchanged by the repeat and no duplicate history entry is stored

### Requirement: The webhook endpoint authenticates the courier
Each provider's webhook endpoint SHALL require that provider's configured bearer token and SHALL reject any request without it. The comparison SHALL NOT leak timing information. An endpoint SHALL reject requests when no token is configured for its provider, rather than accepting them unauthenticated.

These endpoints are necessarily outside the session-based authentication every other courier route uses, so the token is their entire boundary.

#### Scenario: A request without the token is refused
- **WHEN** a provider's webhook endpoint is called without that provider's configured bearer token
- **THEN** the request is rejected and nothing is recorded

#### Scenario: No token configured means no access
- **WHEN** a provider's webhook endpoint is called while no webhook token is configured for it
- **THEN** the request is rejected rather than accepted

### Requirement: Consignments that have gone quiet are reconciled on a schedule
The system SHALL periodically query, for each consignment that is not in a terminal state and has not been heard from recently, **the provider that created it** — not the provider currently configured — and SHALL record what it finds. Terminal consignments SHALL NOT be re-queried. A consignment whose creating provider no longer has usable credentials SHALL be reported rather than silently skipped.

A webhook is one delivery attempt against an endpoint that will sometimes be mid-deploy or briefly unreachable, and a missed one is otherwise undetectable — the order simply sits shipped forever. This job looks for that silence. Routing by the creating provider is what lets consignments from a previously configured courier continue to settle.

#### Scenario: A consignment with no recent notification is polled
- **WHEN** reconciliation runs and a non-terminal consignment has not been heard from within the staleness window
- **THEN** the provider that created it is queried and the returned status and observation time are recorded

#### Scenario: In-flight consignments settle against their own provider
- **WHEN** reconciliation runs on a consignment created by a provider other than the one currently configured
- **THEN** it is queried against the provider that created it, using that provider's credentials

#### Scenario: A recently updated consignment is left alone
- **WHEN** reconciliation runs and a consignment received a notification inside the staleness window
- **THEN** it is not queried

#### Scenario: A settled consignment is left alone
- **WHEN** reconciliation runs and a consignment is already delivered or cancelled
- **THEN** it is not queried

#### Scenario: A courier outage does not corrupt state
- **WHEN** a provider is unreachable during reconciliation
- **THEN** existing statuses are left unchanged and the failure is recorded rather than surfaced as a delivery state

#### Scenario: An unusable creating provider is reported
- **WHEN** reconciliation reaches a consignment whose creating provider has no usable credentials
- **THEN** the consignment is left unchanged and reported as unreconcilable, naming the provider

### Requirement: Staff can read the courier account balance
Staff SHALL be able to retrieve the current account balance from the configured provider, where that provider supports balance enquiry.

#### Scenario: Balance is retrieved
- **WHEN** staff request the courier balance and the configured provider supports it
- **THEN** the current balance reported by that provider is returned

#### Scenario: Balance is not offered where unsupported
- **WHEN** the configured provider does not support balance enquiry
- **THEN** no balance is offered and a direct request is refused, naming the provider

### Requirement: Staff can raise a courier return request
Staff SHALL be able to request a return for a dispatched consignment through the provider that created it, optionally with a reason, where that provider supports return requests. The request's identifier and status SHALL be recorded against the order.

#### Scenario: A return is requested for a dispatched order
- **WHEN** staff raise a courier return for an order carrying a consignment, with a reason, and the creating provider supports returns
- **THEN** that provider records the request and its identifier and status are stored against the order

#### Scenario: A return cannot be raised for an undispatched order
- **WHEN** staff attempt a courier return for an order with no consignment
- **THEN** the request is refused, naming the absence of a consignment

#### Scenario: A return is not offered where unsupported
- **WHEN** the consignment's creating provider does not support return requests
- **THEN** no return action is offered and a direct request is refused, naming the provider

## ADDED Requirements

### Requirement: Dispatch routes to the configured provider
Dispatch SHALL send consignments to the provider configured in store settings at the time of the request. All existing dispatch guarantees SHALL hold for every provider: at most one consignment per order, per-order outcomes matched by invoice rather than position, results persisted before the next batch is sent, and an unknown outcome reported as unconfirmed rather than failed.

These guarantees are properties of dispatching to *a courier*, not of dispatching to Steadfast. A provider that weakened any of them would reintroduce the duplicate-consignment failure the courier module exists to prevent.

#### Scenario: Dispatch uses the configured provider
- **WHEN** staff dispatch a selection of packed orders
- **THEN** the consignments are created with the provider named in store settings, and each resulting shipment records that provider

#### Scenario: Dispatch guarantees hold for every provider
- **WHEN** a dispatch through any provider times out or returns an unreadable response
- **THEN** the affected orders are reported as unconfirmed rather than failed, exactly as for Steadfast

#### Scenario: Dispatch is refused when the provider creates no consignments
- **WHEN** staff attempt to dispatch while the configured provider supports no dispatch
- **THEN** the request is refused, naming the provider, and no order's status changes

### Requirement: Staff see the configured provider named throughout
Every courier action and status presented to staff SHALL name the configured provider rather than a fixed courier name. A shipment created by a provider other than the one currently configured SHALL be displayed as belonging to its creating provider.

An operator dispatching through Pathao while every button reads "Send to Steadfast" cannot trust anything else the panel tells them.

#### Scenario: The dispatch action names the configured provider
- **WHEN** staff view a packed order while a given provider is configured
- **THEN** the dispatch action names that provider

#### Scenario: An existing consignment shows its own provider
- **WHEN** staff view an order whose consignment was created by a provider other than the one now configured
- **THEN** the shipment is shown as belonging to the provider that created it
