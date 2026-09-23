## Purpose

Gives warehouse staff the paper an order needs to leave the building: a pick list, a customer invoice, and a parcel label carrying a scannable barcode of the order number. Also defines the `PACKED` fulfilment state those documents belong to, and the scan-to-open lookup that turns a barcode read back into an order on screen.

## ADDED Requirements

### Requirement: Packed fulfilment state

An order SHALL have a `PACKED` state, occupying the point in fulfilment after its contents have been picked and boxed but before it has been handed to a carrier.

The state SHALL be reachable only from `PROCESSING`, and SHALL lead only to `SHIPPED` or `CANCELLED`. Cancelling a `PACKED` order SHALL return its items to stock, because a packed parcel has not left the premises.

Every surface that renders an order's state — the admin, and the customer-facing order timeline — SHALL display `PACKED` with its own label rather than an empty, raw, or unknown value.

#### Scenario: Packing a processing order

- **WHEN** staff move an order in `PROCESSING` to `PACKED`
- **THEN** the order's state becomes `PACKED` and the transition is recorded in its status history

#### Scenario: Packed order ships

- **WHEN** staff move an order in `PACKED` to `SHIPPED`
- **THEN** the transition is accepted

#### Scenario: Packing is not reachable from an unpicked order

- **WHEN** staff attempt to move an order in `PENDING` or `CONFIRMED` directly to `PACKED`
- **THEN** the transition is rejected and the order's state is unchanged

#### Scenario: Cancelling a packed order restocks it

- **WHEN** a `PACKED` order is cancelled
- **THEN** the order's items are returned to stock

#### Scenario: Customer sees the packed state

- **WHEN** a customer views an order that is `PACKED`
- **THEN** the order timeline shows a packed step with a human-readable label

### Requirement: Packing slip

Staff SHALL be able to produce a printable packing slip for any placed order.

The packing slip SHALL identify the order by its number and placement date, name the recipient, and list every line item with its product name, variant (when the line names one), SKU (when the line carries one), and quantity ordered.

The packing slip SHALL NOT display unit prices, line totals, order totals, or any cost figure. It is the picker's document, and the merchant's buying cost in particular MUST never reach it.

#### Scenario: Packing slip lists what to pick

- **WHEN** staff print the packing slip for an order with three line items
- **THEN** all three items appear with their name, quantity, and SKU where present

#### Scenario: Packing slip omits money

- **WHEN** a packing slip is produced for any order
- **THEN** no unit price, line total, order total, or unit cost appears on it

### Requirement: Invoice

Staff SHALL be able to produce a printable invoice for any placed order.

The invoice SHALL show the store's own identity (name, and contact details and logo where the store has configured them), the order number and date, the recipient's name and address, and every line item with quantity, unit price and line total.

It SHALL show the order's subtotal, discount, shipping and tax amounts, and its total. It SHALL additionally show the amount already paid and the balance still due, so a cash-on-delivery parcel states what the courier must collect.

All monetary values SHALL be rendered in the store's configured currency and to the store's configured number of decimal places.

The invoice SHALL NOT display any per-item cost basis.

#### Scenario: Invoice totals match the order

- **WHEN** staff print the invoice for an order
- **THEN** the subtotal, discount, shipping, tax and total shown equal those recorded on the order

#### Scenario: Cash-on-delivery balance is stated

- **WHEN** an invoice is printed for an unpaid order totalling 1200
- **THEN** the invoice shows an amount due of 1200

#### Scenario: Partially paid order shows the remainder

- **WHEN** an invoice is printed for an order totalling 1200 against which 500 has been paid
- **THEN** the invoice shows 500 paid and 700 due

#### Scenario: Invoice omits cost basis

- **WHEN** an invoice is produced for any order
- **THEN** no per-item cost figure appears on it

### Requirement: Shipping label

Staff SHALL be able to produce a printable shipping label for any placed order.

The label SHALL carry the recipient's name, full delivery address and contact phone, the store's return identity, and a machine-readable barcode encoding the order number, with that order number also printed in human-readable form directly beneath the barcode.

Where an order has no delivery address — a collection order, or one whose address was removed — the label SHALL state that the order is for collection rather than rendering a blank address block.

#### Scenario: Label carries the delivery address

- **WHEN** staff print the shipping label for an order with a delivery address
- **THEN** the recipient's name, address and phone appear on it

#### Scenario: Label carries a scannable order number

- **WHEN** staff print a shipping label for order `ORD-20260908-A1B2C3`
- **THEN** the label shows a barcode encoding `ORD-20260908-A1B2C3` and prints that same text beneath it

#### Scenario: Collection order has no address block

- **WHEN** staff print a shipping label for an order with no delivery address
- **THEN** the label identifies the order as collection rather than showing an empty address

### Requirement: Barcode encoding

A barcode rendered on a fulfilment document SHALL encode the exact order number, such that a commodity barcode scanner reading it reports that order number and nothing else — no prefix, suffix, or altered case.

The barcode SHALL be produced from the order number alone, without contacting any external service, so that documents remain printable when the network is unavailable.

Where an order number contains a character the barcode symbology cannot represent, the document SHALL still render, showing the human-readable order number without a barcode rather than an incorrect or truncated one.

#### Scenario: Scanned barcode reproduces the order number

- **WHEN** a scanner reads the barcode printed on a shipping label
- **THEN** it reports exactly the order number shown in text beneath it

#### Scenario: Barcode needs no network

- **WHEN** a fulfilment document is printed while the machine has no internet access
- **THEN** the barcode renders normally

#### Scenario: Unencodable order number degrades safely

- **WHEN** a document is produced for an order whose number contains a character the symbology cannot represent
- **THEN** the document renders with the order number in text and without a barcode

### Requirement: Thermal and A4 output

Each fulfilment document SHALL be printable to both an 80mm thermal receipt printer and A4 paper.

The packing slip and shipping label SHALL default to thermal output; the invoice SHALL default to A4. Staff SHALL be able to switch a document to the other size before printing, and that choice SHALL persist for that document type on that machine.

At the selected size the document SHALL fit the paper width without horizontal clipping, and SHALL print in black and white legibly, without relying on background colour or shading to convey information — thermal printers reproduce neither.

Only the document SHALL be printed: the admin's own navigation, sidebar, buttons and other interface chrome MUST NOT appear on the printed page.

#### Scenario: Thermal default for a packing slip

- **WHEN** staff open the packing slip for an order for the first time
- **THEN** it is laid out for 80mm thermal paper

#### Scenario: A4 default for an invoice

- **WHEN** staff open the invoice for an order for the first time
- **THEN** it is laid out for A4 paper

#### Scenario: Size choice is remembered

- **WHEN** staff switch the invoice to thermal and later open the invoice for a different order
- **THEN** it opens in thermal

#### Scenario: Interface chrome is excluded

- **WHEN** staff print any fulfilment document
- **THEN** the printed page contains only the document, with no navigation or controls

### Requirement: Scan to open an order

Staff SHALL be able to bring an order onto the screen by scanning the barcode on its shipping label with a scanner that types the scanned value, without using the mouse or keyboard.

When a scanned order number matches exactly one order, the admin SHALL open that order's detail view directly. When it matches none, or more than one, the admin SHALL show the search result as it would for a typed query, so the operator can see what was actually found.

#### Scenario: Scan opens the matching order

- **WHEN** staff scan a label barcode that matches exactly one order
- **THEN** that order's detail view opens

#### Scenario: Scan with no match

- **WHEN** staff scan a value matching no order
- **THEN** the orders list shows an empty result for that search term rather than navigating

#### Scenario: Ambiguous scan does not guess

- **WHEN** a scanned value matches more than one order
- **THEN** the orders list shows those matches and no navigation occurs

### Requirement: Document access is staff-only

Fulfilment documents SHALL be available only to staff roles. A customer SHALL NOT be able to reach the packing slip, invoice or shipping label for any order, including their own, through this capability.

#### Scenario: Customer cannot reach fulfilment documents

- **WHEN** a customer-role session attempts to open a fulfilment document
- **THEN** access is refused
