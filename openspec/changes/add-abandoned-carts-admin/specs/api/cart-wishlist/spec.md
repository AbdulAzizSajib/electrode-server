## ADDED Requirements

### Requirement: A cart is abandoned when its items have been untouched for 24 hours
A cart SHALL count as abandoned when it holds at least one item and none of its items has been added or changed within the last 24 hours. A cart's last activity SHALL be the most recent time any of its items was added or changed, so a shopper still adding to a cart keeps it out of the abandoned set however old the cart itself is.

A cart with no items SHALL NOT count as abandoned.

#### Scenario: Cart left a day ago
- **WHEN** a cart's items were all last added or changed more than 24 hours ago
- **THEN** the cart is abandoned

#### Scenario: Old cart, recent item
- **WHEN** a cart was created a week ago and an item was added to it an hour ago
- **THEN** the cart is not abandoned

#### Scenario: Empty cart
- **WHEN** a cart holds no items
- **THEN** it is not abandoned, however old it is

### Requirement: Staff can list abandoned carts with their owners and contents
The API SHALL let OWNER, ADMIN and STAFF list abandoned carts, most recent activity first and paginated. Each cart SHALL include:
- its owner: the customer's name, phone and email for a customer's cart, or an indication that it is a guest cart;
- each item's product, variant, quantity and unit price;
- the cart's total value;
- its last activity.

A guest cart's token SHALL NOT be returned, because it is the credential that opens that cart.

Unit prices and totals SHALL be the prices the shopper would be charged at the moment of the request, including any active campaign, the same prices the shopper's own cart shows.

An unauthenticated request, or one from a role outside these three, SHALL be refused.

#### Scenario: Customer's abandoned cart
- **WHEN** staff list abandoned carts and one belongs to a logged-in customer
- **THEN** that cart shows the customer's name, phone and email, its items and its total

#### Scenario: Guest's abandoned cart
- **WHEN** an abandoned cart belongs to a guest
- **THEN** it is marked as a guest cart
- **AND** its guest token is not in the response

#### Scenario: Item on campaign
- **WHEN** an abandoned cart holds a product whose price an active campaign is cutting
- **THEN** the item's unit price and the cart's total use the campaign price

#### Scenario: Unauthorised request
- **WHEN** a request without an admin session asks for abandoned carts
- **THEN** it is refused with 401

### Requirement: Staff can see how much is sitting in abandoned carts
The API SHALL give OWNER, ADMIN and STAFF a summary of abandoned carts: how many there are, how many belong to customers and how many to guests, and their total value at the prices described above.

#### Scenario: Summary
- **WHEN** staff request the abandoned-cart summary
- **THEN** the response carries the total number of abandoned carts, the split between customer and guest carts, and their combined value

### Requirement: Owners and admins can delete chosen carts
The API SHALL let OWNER and ADMIN delete carts by id, removing their items with them. STAFF SHALL be refused with 403. Ids that no longer exist SHALL be ignored rather than failing the request, so a repeated or concurrent delete settles. The response SHALL say how many carts were deleted.

Deleting a cart SHALL NOT break the shopper it belonged to: their next cart request SHALL simply start a new, empty cart.

#### Scenario: Owner deletes two carts
- **WHEN** an owner deletes two carts by id
- **THEN** both carts and their items are removed and the response reports 2

#### Scenario: Staff tries to delete
- **WHEN** a STAFF user asks to delete a cart
- **THEN** the request is refused with 403 and nothing is deleted

#### Scenario: Shopper returns after their cart was deleted
- **WHEN** a shopper whose cart was deleted opens their cart again
- **THEN** they are given a new, empty cart and no error

#### Scenario: Cart already gone
- **WHEN** a delete names a cart that no longer exists
- **THEN** the request succeeds and that id is not counted

### Requirement: Owners and admins can purge old guest carts and empty carts
The API SHALL let OWNER and ADMIN purge, in one request:
- **guest carts whose last activity is at least 7, 30 or 90 days old**, as the request chooses; a guest cart with no items counts from when it was created;
- **empty carts**, guest or customer, **created more than 24 hours ago**.

No other bulk deletion SHALL be offered: a purge can never remove a customer's cart that still holds items. STAFF SHALL be refused with 403. The response SHALL say how many carts each rule removed.

#### Scenario: Purge guest carts older than 30 days
- **WHEN** an owner purges guest carts older than 30 days
- **THEN** every guest cart whose last activity is over 30 days old is removed
- **AND** no customer's cart is removed

#### Scenario: Purge empty carts
- **WHEN** an admin purges empty carts
- **THEN** every cart with no items created more than 24 hours ago is removed, whether guest or customer
- **AND** no cart holding items is removed

#### Scenario: Empty cart just created
- **WHEN** a visitor's empty cart was created an hour ago and an admin purges empty carts
- **THEN** that cart is kept

#### Scenario: Unsupported age
- **WHEN** a purge asks for an age other than 7, 30 or 90 days
- **THEN** it is refused with 400 and nothing is removed

### Requirement: Every cart deletion leaves an audit record
Every delete and every purge SHALL write one audit record naming the user who made it. A delete's record SHALL list the ids of the carts it removed. A purge's record SHALL state the rules applied and how many carts each removed.

#### Scenario: Delete is audited
- **WHEN** an owner deletes three carts
- **THEN** one audit record names the owner and the three cart ids

#### Scenario: Purge is audited
- **WHEN** an admin purges guest carts older than 90 days and empty carts
- **THEN** one audit record names the admin, both rules, and each rule's count
