## ADDED Requirements

### Requirement: Completing a return restocks the returned item
Moving a `ReturnRequest` to `COMPLETED` SHALL increase `Stock.quantity` at an admin-specified warehouse by each `ReturnItem`'s quantity and record a `StockMovement` with `type: RETURN`, mirroring how purchase-order receiving already restocks inventory.

#### Scenario: Admin completes a return
- **WHEN** an admin moves a `ReturnRequest` to `COMPLETED` and specifies a warehouse to receive the returned stock
- **THEN** `Stock.quantity` at that warehouse increases by each returned item's quantity
- **AND** a `StockMovement` with `type: RETURN` is created per item, referencing the return
