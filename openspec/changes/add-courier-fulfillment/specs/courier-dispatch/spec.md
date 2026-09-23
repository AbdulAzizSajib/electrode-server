## Purpose

Covers handing a day's parcels to a courier as one operation rather than one order at a time: assigning many orders to a courier at once, and producing the signed handover sheet that records what actually left the building.

## ADDED Requirements

### Requirement: Assigning many orders to a courier at once

Staff SHALL be able to select several orders and assign them all to one courier in a single action.

For each selected order the system SHALL record a shipment naming that courier, creating one where the order has none and updating the courier on the one it already has. An order that already names a different courier SHALL be reassigned, because a parcel moved from one courier to another is an ordinary correction.

The assignment SHALL be applied to every selected order or to none: if any order in the selection cannot be assigned, no order in that selection SHALL be left changed. The response SHALL state how many orders were assigned.

#### Scenario: Orders without shipments are assigned

- **WHEN** staff select four orders that have no shipment and assign them to a courier
- **THEN** four shipments are created naming that courier and the response reports four assigned

#### Scenario: Existing shipment is reassigned

- **WHEN** staff assign an order whose shipment already names a different courier
- **THEN** that shipment's courier becomes the newly chosen one

#### Scenario: A failure leaves the whole selection untouched

- **WHEN** one order in a selection cannot be assigned
- **THEN** the request fails and no order in that selection has been changed

#### Scenario: Inactive courier cannot receive an assignment

- **WHEN** staff attempt to assign orders to a courier that is inactive
- **THEN** the request is refused and no shipment is changed

### Requirement: Status advances with assignment

Handing a parcel to a courier is a fulfilment event, so assigning orders to a courier SHALL advance each order's status to reflect that it has been dispatched, using the same transition rules that govern a single order's status change.

An order whose current status cannot legally reach the dispatched state SHALL NOT be silently skipped: the system SHALL refuse the assignment and name the orders that blocked it, so staff can see which parcels are not ready rather than discovering later that some never moved.

A cancelled order SHALL never be assignable to a courier.

#### Scenario: Packed orders ship on assignment

- **WHEN** staff assign a selection of packed orders to a courier
- **THEN** each order's status becomes shipped and each transition is recorded in its status history

#### Scenario: An ineligible order blocks the batch

- **WHEN** a selection contains an order whose status cannot reach the dispatched state
- **THEN** the request is refused and identifies that order, and no order in the selection has changed

#### Scenario: Cancelled orders are refused

- **WHEN** staff include a cancelled order in a selection to assign
- **THEN** the request is refused

### Requirement: Collection orders are never assigned to a courier

An order the customer is collecting in person SHALL NOT be assignable to a courier, whether individually or as part of a selection. Including one in a selection SHALL cause the request to be refused and that order to be named.

This protects against handing a parcel that somebody is coming to fetch to a delivery company, and against charging for a delivery nobody asked for.

#### Scenario: Collection order in a selection is refused

- **WHEN** staff include a collection order in a selection to assign to a courier
- **THEN** the request is refused, identifies that order, and no order in the selection is changed

### Requirement: Courier handover manifest

Staff SHALL be able to produce a printable manifest for a set of orders going to one courier.

The manifest SHALL name the store and the courier, carry the date it was produced, and list each parcel with its order number, the recipient's name, the delivery destination, and — where the parcel is to be collected on delivery — the amount the courier must collect. It SHALL state the number of parcels listed and the total amount to be collected across them.

The manifest SHALL provide a place for the courier's representative to sign and for the handover time to be written, because its purpose is to be the merchant's record of what was handed over and to whom.

The manifest SHALL NOT show any per-item cost basis or the merchant's buying price.

#### Scenario: Manifest lists the consignment

- **WHEN** staff produce a manifest for six orders assigned to one courier
- **THEN** all six appear with their order number, recipient and destination, and the sheet states six parcels

#### Scenario: Collection amounts are totalled

- **WHEN** a manifest covers three cash-on-delivery parcels of 500, 700 and 1200
- **THEN** each amount is listed against its parcel and the manifest states 2400 to be collected

#### Scenario: Manifest carries a signature area

- **WHEN** staff print a manifest
- **THEN** it contains a signature area and a place to record the handover time

#### Scenario: Manifest omits cost basis

- **WHEN** a manifest is produced for any consignment
- **THEN** no per-item cost or buying price appears on it

### Requirement: Dispatch actions are staff-only

Assigning orders to a courier and producing a handover manifest SHALL be restricted to staff roles. A customer SHALL NOT be able to perform either, including for their own orders.

Every bulk assignment SHALL be recorded in the audit log against the user who performed it, identifying the courier and the orders affected.

#### Scenario: Customer cannot assign orders

- **WHEN** a customer-role session attempts to assign orders to a courier
- **THEN** access is refused

#### Scenario: Bulk assignment is audited

- **WHEN** staff assign twelve orders to a courier
- **THEN** an audit entry records the author, the courier and the orders affected
