## Purpose

How the admin panel's frame behaves on phones and touch screens, so a merchant running their shop from a phone can move between the screens they use most, read pages at full height, and operate every shared control with a finger.

## ADDED Requirements

### Requirement: A bottom navigation bar on narrow screens
Below the width at which the sidebar is shown, the panel SHALL show a navigation bar fixed to the bottom of the screen with five items, in this order: Home, Orders, Products, Inventory, More.

Home, Orders and Products SHALL open the dashboard, the orders list and the products list. Inventory SHALL open the stock screen. More SHALL open the full navigation menu.

An item SHALL be marked as current when the page being shown belongs to it; Inventory SHALL count as current on any screen in the sidebar's Inventory section, and More SHALL count as current on any screen not covered by the other four. Items SHALL follow the same role rules as the sidebar, so the bar never offers a screen the menu would hide.

The bar SHALL NOT be shown at widths where the sidebar is shown.

#### Scenario: Merchant on a phone
- **WHEN** the panel is opened on a phone
- **THEN** a bar with Home, Orders, Products, Inventory and More is fixed to the bottom of the screen

#### Scenario: Merchant on a desktop
- **WHEN** the panel is opened at a width where the sidebar is shown
- **THEN** no bottom bar is shown

#### Scenario: Opening the rest of the menu
- **WHEN** the merchant taps More
- **THEN** the full navigation menu opens with every section the merchant's role may see
- **AND** choosing an entry navigates there and closes the menu

#### Scenario: Current item on an Inventory sub-screen
- **WHEN** the merchant is on a screen listed under the sidebar's Inventory section, such as Returns
- **THEN** Inventory is marked as current

#### Scenario: Current item elsewhere
- **WHEN** the merchant is on a screen none of the first four items covers, such as SEO settings
- **THEN** More is marked as current

### Requirement: New orders are visible from the bottom bar
The Orders item SHALL show the number of pending orders whenever it is greater than zero, from the same live count the sidebar uses, capped for display at "99+".

#### Scenario: Pending orders arrive
- **WHEN** there are pending orders and the merchant is on a phone
- **THEN** the Orders item shows their count without the menu being opened

#### Scenario: No pending orders
- **WHEN** there are no pending orders
- **THEN** the Orders item shows no count

### Requirement: The page scrolls as a document on narrow screens
Below the sidebar width, the page SHALL scroll as the browser document, so mobile browsers can collapse their own address and tool bars. The top bar SHALL stay at the top of the screen while the page scrolls.

Content SHALL never end hidden behind the bottom bar: the last content of every page SHALL be reachable above the bar, including the device's safe area at the bottom of the screen.

At widths where the sidebar is shown, the panel SHALL keep the whole window and scroll its content area alone, as it does today.

#### Scenario: Scrolling a long page on a phone
- **WHEN** a merchant scrolls down a long page on a phone
- **THEN** the document scrolls and the browser may collapse its own bars
- **AND** the top bar remains visible

#### Scenario: Reaching the bottom of a page
- **WHEN** a merchant scrolls to the end of any page on a phone
- **THEN** the last content is fully visible above the bottom bar

#### Scenario: Desktop layout unchanged
- **WHEN** the panel is used at a width where the sidebar is shown
- **THEN** the sidebar and top bar stay in place and only the content area scrolls

### Requirement: Each page opens at its top
Navigating from one page of the panel to another SHALL show the new page from its top, whichever element is scrolling.

#### Scenario: Opening an order from far down a list
- **WHEN** a merchant scrolls far down the orders list and opens an order
- **THEN** the order page is shown from its top

### Requirement: Sticky bars sit above the bottom bar
Any bar that stays fixed to the bottom of a page's content, such as a settings editor's save bar, SHALL sit above the bottom navigation bar on narrow screens rather than behind it.

#### Scenario: Saving settings on a phone
- **WHEN** a merchant edits a settings page on a phone
- **THEN** its save bar is fully visible and tappable above the bottom bar

### Requirement: Shared controls are finger-sized on touch screens
On a device whose primary pointer is coarse (a touch screen), the panel's shared buttons SHALL be at least 40px tall, shared icon-only buttons SHALL be at least 44px square, and shared text fields, text areas, selects and searchable selects SHALL be at least 44px tall with text of at least 16px, so that focusing a field does not zoom the page on iOS.

On a device whose primary pointer is fine (a mouse), these controls SHALL keep their current sizes.

#### Scenario: Focusing a field on an iPhone
- **WHEN** a merchant taps a text field on iOS Safari
- **THEN** the page does not zoom in

#### Scenario: Tapping a toolbar icon on a phone
- **WHEN** a merchant taps a shared icon-only button on a phone
- **THEN** its tappable area is at least 44px square

#### Scenario: Desktop sizes unchanged
- **WHEN** the panel is used with a mouse
- **THEN** buttons and fields keep their existing sizes

### Requirement: No action is tappable while invisible
An action control SHALL NOT be both invisible and operable. Actions revealed on hover SHALL be shown permanently on touch screens, where hover does not exist.

#### Scenario: Category actions on a phone
- **WHEN** a merchant views the categories tree on a phone
- **THEN** each category's add, edit and delete actions are visible

#### Scenario: Home slider slot actions on a phone
- **WHEN** a merchant views the home slider slots on a phone
- **THEN** each slot's edit and remove actions are visible

#### Scenario: Hover reveal kept for mouse users
- **WHEN** the same screens are used with a mouse
- **THEN** the actions still appear on hover and on keyboard focus, as today
