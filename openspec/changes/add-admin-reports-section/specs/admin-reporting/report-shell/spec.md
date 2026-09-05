## Purpose

Defines the Report section of the admin panel as a place: that it exists as its own parent menu with a fixed set of children, who is allowed to reach it, and the contract every report inside it honours — how a period is chosen, how filters compose, how results are paged, and what an export produces.

## ADDED Requirements

### Requirement: The admin panel has a Report section with five reports

The system SHALL present a top-level **Report** navigation section in the admin panel containing exactly five reports: Stock report, Sales report, Purchases report, Stock history, and Payment history. Each SHALL be reachable at its own address so a merchant can bookmark or link to one directly.

#### Scenario: Merchant opens the Report menu

- **WHEN** a signed-in merchant expands the Report section in the admin navigation
- **THEN** exactly five entries are listed — Stock report, Sales report, Purchases report, Stock history, Payment history — each linking to its own page

#### Scenario: Report page is opened directly by address

- **WHEN** a signed-in merchant navigates straight to a report's address without going through the menu
- **THEN** that report loads, and the Report section is shown expanded with that entry marked current

#### Scenario: Existing navigation is unaffected

- **WHEN** the Report section is present
- **THEN** Inventory still lists Stock Movements at its existing address, and no entry is removed from or moved out of any other section

### Requirement: Reports are reachable only by admin-panel staff

The system SHALL restrict every report — both its page and the data behind it — to store owners, administrators and staff. A customer session, or no session, SHALL NOT be able to read report data by any route.

#### Scenario: Customer session requests report data

- **WHEN** a request carrying a customer's session asks for any report's data
- **THEN** it is rejected as unauthorised and no report data is returned

#### Scenario: Unauthenticated request

- **WHEN** an unauthenticated request asks for any report's data
- **THEN** it is rejected as unauthorised

#### Scenario: Staff member opens a report

- **WHEN** a signed-in staff member opens any of the five reports
- **THEN** the report loads and returns data

### Requirement: Period-based reports take an explicit start and end date

The system SHALL let a merchant choose an explicit start and end date on the Sales report, Purchases report, Stock history and Payment history, and SHALL include both endpoints in the result. The Stock report SHALL NOT offer a date range, because it states a present position rather than a period.

#### Scenario: Merchant selects a range

- **WHEN** a merchant sets a start of 1 March and an end of 31 March and applies it
- **THEN** the report covers everything dated from the very start of 1 March to the very end of 31 March, and nothing outside it

#### Scenario: Range endpoints are inclusive at the boundary

- **WHEN** a record is dated at the last moment of the chosen end date
- **THEN** that record is included in the report

#### Scenario: End date precedes start date

- **WHEN** a merchant applies a range whose end date is earlier than its start date
- **THEN** the request is rejected with a message naming the problem, and the previously displayed results are left unchanged rather than replaced by an empty table

#### Scenario: No range supplied

- **WHEN** a period-based report is opened without a stored or supplied range
- **THEN** it defaults to the last 30 days ending today, and the date inputs show that range so the merchant can see what they are looking at

#### Scenario: Stock report offers no range

- **WHEN** a merchant opens the Stock report
- **THEN** no date range control is presented, and the page states that the figures are the position as of now

### Requirement: Filters compose and are stated on screen

The system SHALL apply every filter a report offers together, narrowing the result to rows matching all of them. Each report SHALL show which filters are currently applied and SHALL offer a single action that clears them back to the report's defaults.

#### Scenario: Two filters applied together

- **WHEN** a merchant filters Payment history to supplier payments and to the bank-transfer method
- **THEN** only supplier payments made by bank transfer are listed, and both filters are visibly in effect

#### Scenario: Filters are cleared

- **WHEN** a merchant clears filters
- **THEN** every filter returns to the report's default, the date range returns to the last 30 days, and the results reload accordingly

#### Scenario: A filter matches nothing

- **WHEN** an applied combination of filters matches no rows
- **THEN** the report shows an empty state that says no records match the current filters and offers to clear them, rather than showing a loading or error state

### Requirement: Report results are paged, and summary totals cover the whole result

The system SHALL page report rows. Any summary figure a report presents SHALL be computed over the **entire filtered result set**, not over the visible page, so that changing the page size never changes a total.

#### Scenario: Merchant moves to the next page

- **WHEN** a merchant advances to page 2 of a report
- **THEN** the next block of rows is shown and every summary figure on the page is unchanged

#### Scenario: Merchant changes page size

- **WHEN** a merchant changes the page size from 10 to 50
- **THEN** more rows are shown and every summary figure is unchanged

#### Scenario: Result exceeds one page

- **WHEN** a filtered result contains more rows than one page holds
- **THEN** the report states the total number of matching rows, not merely the number displayed

### Requirement: Every report exports the full filtered result as CSV

The system SHALL offer a CSV export on every report. The export SHALL contain **every row matching the currently applied date range and filters** — not only the visible page — with a header row naming each column, and SHALL be ordered the same way the on-screen report is ordered.

#### Scenario: Export reflects the applied filters

- **WHEN** a merchant filters a report down to 240 matching rows across 24 pages and exports
- **THEN** the downloaded file contains all 240 rows plus one header row

#### Scenario: Export column values match the screen

- **WHEN** a merchant compares an exported row against the same row on screen
- **THEN** every column holds the same value, with amounts as plain decimal numbers so a spreadsheet reads them as numbers rather than text

#### Scenario: Value contains a comma, quote or line break

- **WHEN** an exported value contains a comma, a double quote or a line break — for example a purchase order note
- **THEN** the file escapes it so the value stays in one field and the row structure is preserved when opened in a spreadsheet

#### Scenario: Export of an empty result

- **WHEN** a merchant exports a report whose filters match no rows
- **THEN** a file containing only the header row is produced, rather than an error or an empty file

#### Scenario: Export is named identifiably

- **WHEN** an export is downloaded
- **THEN** its filename identifies the report and the range or date it covers, so several exports do not collide in a downloads folder

### Requirement: Report exports are recorded in the audit trail

The system SHALL record every report export in the audit trail as an export action, capturing which report was exported, the range and filters that produced it, and who exported it. Viewing a report on screen SHALL NOT be recorded.

#### Scenario: Merchant exports a report

- **WHEN** a merchant exports the Sales report for March filtered to one payment method
- **THEN** an export entry appears in the audit trail naming the Sales report, the range, the filter, and the acting user

#### Scenario: Merchant only views a report

- **WHEN** a merchant opens a report, pages through it, and changes filters without exporting
- **THEN** no audit entry is written

### Requirement: A report that cannot be produced fails visibly and keeps the page usable

The system SHALL report a failure to produce report data as a failure, and SHALL NOT present a partial or zeroed result as a complete one. The merchant SHALL be able to retry without losing their range and filters.

#### Scenario: Report data cannot be loaded

- **WHEN** a report's data cannot be produced
- **THEN** the page shows that it failed and offers a retry, and the chosen range and filters remain as the merchant set them

#### Scenario: Export fails

- **WHEN** an export cannot be produced
- **THEN** the merchant is told the export failed, no file is downloaded, and the on-screen report is left untouched
