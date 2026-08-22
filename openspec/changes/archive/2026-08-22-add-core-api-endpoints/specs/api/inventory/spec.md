## Purpose

Gives admin staff control over warehouses, stock levels, and the supplier/purchase-order procurement cycle that replenishes stock.

## ADDED Requirements

### Requirement: Stock changes are always logged as a StockMovement
Any change to `Stock.quantity` SHALL be accompanied by a `StockMovement` row recording the type (purchase, sale, return, adjustment, etc.) and quantity delta — `Stock` is never edited directly without a corresponding audit trail entry.

#### Scenario: Admin manually adjusts stock
- **WHEN** an admin corrects a warehouse's stock count for a product
- **THEN** `Stock.quantity` changes AND a `StockMovement` with `type: ADJUSTMENT` is created recording the delta and an optional note

### Requirement: Receiving a purchase order increases stock and records the movement
Marking `PurchaseOrderItem.receivedQuantity` up SHALL increase the corresponding `Stock.quantity` at the purchase order's implied warehouse and create a `StockMovement` with `type: PURCHASE`.

#### Scenario: Partial receipt of a purchase order
- **WHEN** an admin receives less than the full ordered quantity for a `PurchaseOrderItem`
- **THEN** `PurchaseOrder.status` becomes `PARTIALLY_RECEIVED`, stock increases by only the received quantity, and the item remains open for further receipt

### Requirement: Only OWNER/ADMIN/STAFF can access inventory endpoints
No inventory or procurement endpoint SHALL be reachable by a customer or an unauthenticated request.

#### Scenario: Customer attempts to view warehouse stock
- **WHEN** a customer-role request calls any inventory endpoint
- **THEN** the response is 403
