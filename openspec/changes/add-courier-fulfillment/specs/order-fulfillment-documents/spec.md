## ADDED Requirements

### Requirement: Batch shipping-label print

Staff SHALL be able to print the shipping labels for a selection of orders as a single print job, rather than opening and printing each order's label in turn.

Each label in the batch SHALL be identical in content to the label that order would produce on its own, and SHALL begin on its own page or label so that no two orders share one physical label and no label is split across a page boundary.

The batch SHALL honour the same paper-size choice as a single label, and SHALL exclude interface chrome from the printed output exactly as a single document does.

Where an order in the selection cannot produce a label, the batch SHALL still print the labels for the rest and SHALL tell staff which orders were omitted — a parcel missing from a print run must be visible, not silently absent.

#### Scenario: One page per label

- **WHEN** staff print labels for five selected orders
- **THEN** five labels are produced, each starting on its own page or label

#### Scenario: Batch label matches the single label

- **WHEN** an order's label is printed as part of a batch
- **THEN** its content is the same as when that order's label is printed on its own

#### Scenario: Paper size applies to the batch

- **WHEN** staff choose thermal output and print a batch of labels
- **THEN** every label in the batch is laid out for thermal paper

#### Scenario: An unprintable order is reported

- **WHEN** a selection contains an order for which no label can be produced
- **THEN** the remaining labels print and staff are told which order was omitted
