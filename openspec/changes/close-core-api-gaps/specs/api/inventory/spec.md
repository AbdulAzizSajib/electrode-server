## ADDED Requirements

### Requirement: Warehouse stock changes keep the denormalized product stock total in sync
Whenever a `StockMovement` changes `Stock.quantity` (via a manual adjustment or a purchase-order receipt), the corresponding `Product`/`ProductVariant.stockQuantity` denormalized total SHALL be updated by the same delta, so it continues to reflect the true sum of that product/variant's `Stock` rows across all warehouses.

#### Scenario: Manual stock adjustment updates the denormalized total
- **WHEN** an admin adjusts a product's stock at a warehouse via `PATCH /stock/:id/adjust`
- **THEN** `Product`/`ProductVariant.stockQuantity` changes by the same delta as the `Stock.quantity` adjustment

#### Scenario: Receiving a purchase order updates the denormalized total
- **WHEN** an admin receives quantity against a `PurchaseOrderItem`
- **THEN** `Product`/`ProductVariant.stockQuantity` increases by the received quantity, in addition to the warehouse `Stock.quantity` increase

### Requirement: Stock dropping to or below the low-stock threshold notifies OWNER/ADMIN
When a stock-decreasing movement (sale, adjustment, damage, loss, transfer-out) brings a product's/variant's total available stock (summed across warehouses) to or below its configured `lowStockThreshold`, every OWNER/ADMIN SHALL be notified.

#### Scenario: A sale brings stock to the low-stock threshold
- **WHEN** an order's stock deduction brings a product's total available stock down to its `lowStockThreshold`
- **THEN** a `Notification` is created for every OWNER/ADMIN user
