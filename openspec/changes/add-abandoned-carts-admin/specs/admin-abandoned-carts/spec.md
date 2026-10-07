## Purpose

The admin screen where a merchant sees the carts shoppers filled and left, follows up with the customers among them, and clears out carts that no longer serve any purpose.

## ADDED Requirements

### Requirement: The Abandoned Carts screen is reachable by every admin role
The admin panel SHALL offer an "Abandoned Carts" screen under the Customers section of the navigation, visible to OWNER, ADMIN and STAFF.

#### Scenario: Staff opens the screen
- **WHEN** a STAFF user opens Customers → Abandoned Carts
- **THEN** the screen shows the summary and the list

### Requirement: The screen summarises and lists abandoned carts
The screen SHALL show, above the list, the number of abandoned carts, the split between customer and guest carts, and their total value.

The list SHALL show one row per abandoned cart, most recent activity first, with:
- who it belongs to: the customer's name, or "Guest";
- how many items it holds;
- its total value;
- how long ago it was last active.

Each row SHALL reveal the cart's products, quantities and unit prices on demand. When there are no abandoned carts the screen SHALL say so, rather than showing an empty table.

#### Scenario: Merchant reviews abandoned carts
- **WHEN** a merchant opens the screen and abandoned carts exist
- **THEN** the summary shows their count, the customer/guest split and their total value
- **AND** the list shows each cart's owner, item count, value and last activity

#### Scenario: Inspecting a cart's contents
- **WHEN** a merchant expands a cart in the list
- **THEN** its products, quantities and unit prices are shown

#### Scenario: Nothing abandoned
- **WHEN** there are no abandoned carts
- **THEN** the screen states that there are none

### Requirement: A merchant can contact a customer from their abandoned cart
For a customer's cart, the screen SHALL show the customer's phone and email. On a phone, the phone number SHALL start a call when tapped. Guest carts SHALL show no contact details, because none exist.

#### Scenario: Calling a customer from a phone
- **WHEN** a merchant on a phone taps the phone number on a customer's abandoned cart
- **THEN** the phone's dialler opens with that number

### Requirement: Deleting and purging are offered only to owners and admins, behind a confirmation
For OWNER and ADMIN, the screen SHALL let the merchant select carts and delete them, and SHALL offer a purge that removes guest carts older than a chosen 7, 30 or 90 days and empty carts. Each SHALL ask for confirmation stating what will be removed, and afterwards SHALL report how many carts were removed and refresh the summary and list.

STAFF SHALL NOT be offered either action.

#### Scenario: Owner deletes selected carts
- **WHEN** an owner selects two carts, chooses delete and confirms
- **THEN** both carts disappear from the list and the screen reports that 2 were deleted

#### Scenario: Admin purges old guest carts
- **WHEN** an admin chooses to purge guest carts older than 30 days and confirms
- **THEN** the screen reports how many guest carts and how many empty carts were removed

#### Scenario: Merchant backs out
- **WHEN** a merchant opens a delete or purge confirmation and cancels
- **THEN** nothing is removed

#### Scenario: Staff sees no destructive actions
- **WHEN** a STAFF user views the screen
- **THEN** no selection, delete or purge control is shown
