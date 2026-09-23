## ADDED Requirements

### Requirement: Bulk document production from a selection

Staff SHALL be able to produce any of the three fulfilment documents for several orders at once, by selecting those orders in the orders list and choosing the document to print.

The batch SHALL be built from the operator's current selection. Because the orders list already filters by status, the common path is to filter to a single status, select the results, and print them as one run; the capability SHALL NOT require the selection to be homogeneous in order to proceed.

A document produced in a batch SHALL be identical to the same document produced for that order alone. The content requirements for the packing slip, the invoice and the shipping label apply unchanged to every document in a batch.

#### Scenario: Printing a selection of orders

- **WHEN** staff select six orders and choose to print packing slips
- **THEN** a packing slip is produced for each of the six orders

#### Scenario: Filtered selection prints as one run

- **WHEN** staff filter the orders list to a single status, select every result, and choose a document
- **THEN** that document is produced for every order in the filtered selection

#### Scenario: A batched document matches its single form

- **WHEN** an invoice for a given order is produced in a batch, and the same order's invoice is produced on its own
- **THEN** the two show the same order number, line items, totals and amount due

#### Scenario: Selection of one

- **WHEN** staff select a single order and print a document for it
- **THEN** that one document is produced, with no batch-specific framing around it

### Requirement: One sheet per document in a batch

Each document in a batch SHALL begin on its own sheet, so that a single print command yields one document per page and no document shares a page with another.

A document SHALL NOT be split across sheets where it fits on one at the selected paper size.

The paper size for a batch SHALL follow the existing per-document-type default and the operator's persisted choice, and SHALL apply to every document in that batch rather than varying within it.

#### Scenario: Six documents yield six sheets

- **WHEN** staff print packing slips for six orders
- **THEN** the print output contains six pages, one document per page

#### Scenario: Batch honours the remembered paper size

- **WHEN** staff have previously switched invoices to thermal, and then print invoices for several orders
- **THEN** every invoice in that batch is laid out for thermal

#### Scenario: One print command covers the batch

- **WHEN** staff issue a single print command for a batch of documents
- **THEN** every document in the batch is printed, with no further command needed per order

### Requirement: Cancelled orders are excluded from a print run

A cancelled order SHALL NOT have a document produced for it in a batch. A cancelled order has no parcel to pick, send or collect against, and a label printed for one invites a parcel that should not be shipped.

The exclusion SHALL be stated on screen, identifying which selected orders were left out and that cancellation is why. It MUST NOT be silent: an operator who selected twelve orders and receives ten documents needs the discrepancy explained where they will see it, not left to a recount.

Where every selected order is cancelled, the view SHALL say so plainly rather than presenting an empty print run.

#### Scenario: Cancelled order is left out and reported

- **WHEN** staff print labels for six selected orders of which two are cancelled
- **THEN** four labels are produced
- **AND** the view states that two orders were excluded because they are cancelled, identifying them

#### Scenario: Nothing printable in the selection

- **WHEN** every order in the selection is cancelled
- **THEN** the view states that there is nothing to print and why, and produces no documents

#### Scenario: No cancelled orders in the selection

- **WHEN** no selected order is cancelled
- **THEN** a document is produced for every selected order and no exclusion notice is shown

### Requirement: Bulk documents are staff-only

Bulk document production SHALL be subject to the same access rule as single-document production: it is available only to staff roles, and a customer SHALL NOT be able to reach it for any set of orders, including their own.

#### Scenario: Customer cannot reach bulk documents

- **WHEN** a customer-role session attempts to open a bulk document view
- **THEN** access is refused
