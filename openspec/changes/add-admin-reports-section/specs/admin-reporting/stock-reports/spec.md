## Purpose

Defines the two stock-facing reports: the Stock report, which states the present stock position and what it is worth, and Stock history, which explains how a stock position got to where it is over a period by reconciling opening balance, movements in and out, and closing balance.

## ADDED Requirements

### Requirement: The Stock report states the present stock position per item

The system SHALL report, for every stocked product and product variant, the quantity on hand, the quantity reserved, and the quantity available (on hand minus reserved). A variant-bearing product SHALL be reported by variant, not rolled into a single product row, because stock is held per variant.

#### Scenario: Simple product with stock

- **WHEN** a merchant opens the Stock report and a simple product holds 40 units with 3 reserved
- **THEN** one row shows that product with 40 on hand, 3 reserved and 37 available

#### Scenario: Product with variants

- **WHEN** a product has three variants holding stock
- **THEN** the report shows one row per variant, each identified by its own code, and does not show a single combined row for the product

#### Scenario: Item with no stock record

- **WHEN** a stocked product exists but has never received stock in any warehouse
- **THEN** it appears with zero on hand, zero reserved and zero available rather than being omitted, so a merchant can see what has run out

### Requirement: The Stock report reports quantity per warehouse and in total

The system SHALL let a merchant view the stock position for one warehouse or across all warehouses. When all warehouses are selected, each item's quantity SHALL be the sum across warehouses, and the merchant SHALL be able to see the per-warehouse split for an item without leaving the report.

#### Scenario: Single warehouse selected

- **WHEN** a merchant filters the Stock report to one warehouse
- **THEN** every quantity shown is that warehouse's quantity alone, and items holding no stock in that warehouse show zero

#### Scenario: All warehouses selected

- **WHEN** a merchant views all warehouses and an item holds 10 units in one warehouse and 6 in another
- **THEN** the item's row shows 16 on hand

#### Scenario: Merchant inspects the split

- **WHEN** a merchant expands an item's row while viewing all warehouses
- **THEN** the per-warehouse quantities that make up its total are shown, and they sum to the total on the row

### Requirement: Warehouse stock records are authoritative for the Stock report

The system SHALL compute the Stock report from the per-warehouse stock records, which are the location-aware source of truth, rather than from the denormalized per-product and per-variant quantity mirrors. Where a mirror disagrees with the sum of warehouse records, the report SHALL show the warehouse-derived figure and SHALL make the disagreement visible rather than silently choosing one.

#### Scenario: Mirror and warehouse records agree

- **WHEN** an item's denormalized quantity equals the sum of its warehouse stock records
- **THEN** the report shows that quantity with no discrepancy indication

#### Scenario: Mirror and warehouse records disagree

- **WHEN** an item's denormalized quantity is 40 but its warehouse stock records sum to 37
- **THEN** the report shows 37 as the quantity on hand and marks the row as having a mismatched cached quantity, stating both figures

#### Scenario: Merchant filters to mismatched rows

- **WHEN** a merchant filters the Stock report to items whose cached quantity disagrees with their warehouse records
- **THEN** only those items are listed, so the discrepancies can be worked through

### Requirement: The Stock report flags items at or below their low-stock threshold

The system SHALL mark every item whose available quantity is at or below its configured low-stock threshold, and SHALL let a merchant filter the report to those items alone.

#### Scenario: Item at its threshold

- **WHEN** an item has 5 available and a low-stock threshold of 5
- **THEN** it is marked as low stock

#### Scenario: Item above its threshold

- **WHEN** an item has 6 available and a low-stock threshold of 5
- **THEN** it is not marked as low stock

#### Scenario: Merchant filters to low stock

- **WHEN** a merchant applies the low-stock filter
- **THEN** only items at or below their threshold are listed, and the summary states how many there are

### Requirement: The Stock report values stock at cost and at retail, and says what it could not value

The system SHALL report the value of stock on hand at cost and at selling price, both per row and as a total over the whole filtered result. Where an item has no cost price recorded, the system SHALL exclude it from the cost total rather than treating its cost as zero, and SHALL state how many items and how many units were excluded.

#### Scenario: Item with a cost price

- **WHEN** an item holds 10 units at a cost of ৳120 and a price of ৳200
- **THEN** its row shows a cost value of ৳1,200 and a retail value of ৳2,000

#### Scenario: Item without a cost price

- **WHEN** an item holds 10 units, has no cost price recorded, and sells for ৳200
- **THEN** its row shows no cost value and a retail value of ৳2,000, and it is not counted as ৳0 of cost

#### Scenario: Totals disclose unvalued stock

- **WHEN** the filtered result contains items without a cost price
- **THEN** the cost total is stated as covering only the valued items, and the number of items and units left out is stated alongside it

#### Scenario: Variant price falls back to its product

- **WHEN** a variant has no price or cost of its own
- **THEN** its product's price or cost is used for valuation, and only when neither exists is the value treated as unavailable

### Requirement: Stock history reconciles opening balance, movements and closing balance over a period

The system SHALL report, for a chosen date range, the opening balance at the start of the range, the total quantity in, the total quantity out, and the closing balance at the end. The four figures SHALL reconcile: **opening + in − out = closing**.

#### Scenario: Merchant runs stock history for a month

- **WHEN** a merchant runs Stock history for one product over March, and the product held 40 units on 1 March, received 60 and shipped 25 during the month
- **THEN** the report states opening 40, in 60, out 25, closing 75

#### Scenario: Figures always reconcile

- **WHEN** any Stock history result is produced
- **THEN** opening plus quantity in minus quantity out equals the stated closing balance

#### Scenario: Range begins before any movement exists

- **WHEN** a range starts before the product's first ever movement
- **THEN** the opening balance is zero rather than blank or unknown

#### Scenario: No movements inside the range

- **WHEN** a product had movements before the range but none inside it
- **THEN** opening and closing are equal and non-zero, in and out are zero, and the report says there were no movements in the period rather than showing the item as having no history

### Requirement: Stock history lists each movement with a running balance

The system SHALL list the individual movements inside the range in chronological order, each stating its date, type, signed quantity, warehouse, note, and the balance after that movement. The balance after the last listed movement SHALL equal the stated closing balance.

#### Scenario: Movements carry a running balance

- **WHEN** a product opens at 40 and receives 60 then ships 25
- **THEN** the two rows show balances of 100 and 75, and the closing balance is 75

#### Scenario: Movement direction is legible

- **WHEN** a movement decreases stock
- **THEN** its quantity is shown as a negative change, visually distinguished from an increase

#### Scenario: Ordering is chronological

- **WHEN** movements are listed
- **THEN** they run oldest to newest, so the running balance reads downward as an accumulation

### Requirement: Stock history can be scoped to a product, a variant, a warehouse or a movement type

The system SHALL let a merchant narrow Stock history by product, by variant, by warehouse, and by movement type. Opening, in, out and closing SHALL be computed under the same scope as the listed movements, so the reconciliation holds for whatever scope is selected.

#### Scenario: Scoped to one warehouse

- **WHEN** a merchant scopes Stock history to one warehouse
- **THEN** the opening balance is that warehouse's balance at the start of the range and the reconciliation holds for that warehouse alone

#### Scenario: Scoped to one movement type

- **WHEN** a merchant filters to purchase movements only
- **THEN** only purchase movements are listed, and the report states that a type filter is in effect and that opening and closing therefore describe the unfiltered position

#### Scenario: No product selected

- **WHEN** no product is selected
- **THEN** the report covers all products, listing movements across them, with opening, in, out and closing aggregated over the whole scope

### Requirement: Stock history does not replace or alter the Stock Movements page

The system SHALL keep the existing Inventory Stock Movements page unchanged in address, content and behaviour. Stock history SHALL be a separate report and SHALL NOT be a redirect to it.

#### Scenario: Stock Movements page still works

- **WHEN** a merchant opens Inventory then Stock Movements
- **THEN** the existing page loads at its existing address with its existing filters and behaviour

#### Scenario: Stock history is a distinct page

- **WHEN** a merchant opens Report then Stock history
- **THEN** a separate page loads offering a date range, an opening-to-closing reconciliation and export — none of which the Stock Movements page offers
