## MODIFIED Requirements

### Requirement: A shipment timestamp recorded in error can be cleared
`shippedAt` and `deliveredAt` SHALL be clearable, not only settable, on a shipment the shop owns. A request that omits a timestamp leaves it unchanged; a request that explicitly clears it SHALL remove it.

Today an omitted value and an explicit clear are indistinguishable, so a delivery date stamped on the wrong order is permanent.

On a shipment owned by a courier these timestamps are derived from the courier's reported state rather than entered by hand, so clearing one only holds until the next synchronisation. Manual timestamp edits on such a shipment SHALL be refused, naming the courier as the source of the value — a control that silently undoes itself is worse than one that is absent.

#### Scenario: Admin clears a wrongly-stamped delivery date
- **WHEN** an admin explicitly clears `deliveredAt` on a shipment with no consignment
- **THEN** the field is emptied and the shipment no longer reads as delivered

#### Scenario: Omitting a timestamp leaves it alone
- **WHEN** an admin updates a shipment's carrier without mentioning its timestamps
- **THEN** `shippedAt` and `deliveredAt` keep their existing values

#### Scenario: Timestamps on a courier-owned shipment are not hand-edited
- **WHEN** an admin attempts to set or clear `shippedAt` or `deliveredAt` on a shipment carrying a consignment id
- **THEN** the request is rejected, naming the courier as the source of those values, and the stored timestamps are unchanged

## ADDED Requirements

### Requirement: A courier-owned shipment's identity and status are not hand-editable
Once a shipment carries a consignment id, its tracking number, carrier and delivery status SHALL be derived from the courier and SHALL NOT be writable through the manual shipment endpoint. Such a request SHALL be refused with a message naming the courier as the owner of those fields.

The manual endpoint accepts any value for tracking number and status. Left open, an operator's correction and the scheduled synchronisation overwrite each other in turn, and the panel shows whichever wrote last — so the record disagrees with both the courier and the operator.

#### Scenario: Editing a courier-owned tracking number is refused
- **WHEN** an admin submits a new `trackingNumber` for a shipment that carries a consignment id
- **THEN** the request is rejected and the stored tracking number is unchanged

#### Scenario: Editing a courier-owned status is refused
- **WHEN** an admin submits a new `status` for a shipment that carries a consignment id
- **THEN** the request is rejected and the stored status is unchanged

#### Scenario: A manual shipment remains fully editable
- **WHEN** an admin updates the tracking number or status of a shipment that carries no consignment id
- **THEN** the update is applied as before

### Requirement: An order carries at most one shipment however it was created
The existing one-shipment-per-order rule SHALL hold regardless of whether the shipment was entered by hand or created by dispatching the order to a courier. An order that already has a manually recorded shipment SHALL NOT gain a second one through courier dispatch.

#### Scenario: Dispatching an order that already has a manual shipment
- **WHEN** an order with a hand-entered shipment is dispatched to the courier
- **THEN** no second shipment is created; the existing shipment is updated with the consignment identity

#### Scenario: Creating a manual shipment for a dispatched order
- **WHEN** an admin attempts to create a shipment for an order that already carries a consignment
- **THEN** the request is rejected as it is today, with the existing shipment left unchanged
