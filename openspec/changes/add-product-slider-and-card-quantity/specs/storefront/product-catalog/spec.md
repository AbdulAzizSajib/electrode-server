## Purpose

Governs how products are presented in a listing and what a shopper can do with one from there — the purchase action a card carries, how a product requiring a choice is distinguished from one that does not, and how a card reflects what is already in the cart.

## ADDED Requirements

### Requirement: A card's purchase action is unaffected by the quantity control beside it

The rule that a listing's purchase action carries the same label and the same visual treatment for every product — so that a shopper scanning a listing cannot tell from the action alone whether a product has variants — SHALL continue to hold unchanged. That rule is stated by `unify-card-add-to-cart-action` in this same capability; this change neither relaxes nor restates it.

It SHALL be read as governing a card whose product is **not yet in the cart**. Where a card instead presents a quantity control, because what it offers is already in the cart, the presence of that control SHALL NOT be taken to reveal anything about whether the product has variants: it reveals only that something has been added, which is equally reachable for a product with variants and one without.

A listing in which no product has been added SHALL therefore present one identically-labelled action per card, exactly as it does today.

#### Scenario: A listing where nothing has been added

- **WHEN** a shopper views a listing showing both products that require a variant choice and products that do not, none of them in the cart
- **THEN** every product's purchase action reads identically and is presented identically
- **AND** no card presents a quantity control

#### Scenario: A mixed listing where one of each has been added

- **WHEN** a listing shows a product with variants and a product without, and the shopper has added one of each
- **THEN** both cards present a quantity control
- **AND** neither card's control differs in a way that reveals which product had variants

### Requirement: A card presents a quantity control for what is already in the cart

The card's quantity control SHALL be a merchant setting, and SHALL default to NOT being offered — a shop that has never opened the setting SHALL show the purchase action it has always shown, whatever the cart holds.

While the setting is off, a card SHALL present its purchase action for every product, and SHALL NOT present a quantity control for any. While it is on, the requirements below apply.

Where the setting is on and a listing's card offers a product that is already in the shopper's cart, that card SHALL present a control for changing how many are in the cart, in place of the purchase action it would otherwise present. The control SHALL show the quantity the cart currently holds.

The control SHALL be derived from the cart, not from what the shopper did during this visit: a card SHALL present it whenever the cart holds that product, including on a first view of the page after the cart was filled elsewhere or in an earlier session.

Changing the quantity from a card SHALL change that line in the cart, and SHALL NOT create a second line for the same item. Reducing the quantity below one SHALL remove the line, after which the card SHALL present its purchase action again.

A card SHALL NOT present a quantity control for a product that is not in the cart, so that a listing of products none of which have been added presents one identically-labelled action per card.

For a product requiring a variant choice, the control SHALL govern the variant that was added, and the card SHALL present it only once such a choice has been made and added.

Where the cart holds more than one variant of the same product, that product's card SHALL present its purchase action rather than a quantity control. A listing card cannot say which of those lines a control would govern, and changing the wrong one is worse than not offering the control.

#### Scenario: A shop that has never opened the setting

- **WHEN** a shop's settings carry no value for the card quantity control
- **THEN** every card presents its purchase action, whatever the cart holds
- **AND** no card presents a quantity control

#### Scenario: The setting is off and the product is in the cart

- **WHEN** the setting is off and a shopper whose cart holds a product views a listing containing it
- **THEN** that card presents its purchase action, not a quantity control

#### Scenario: Settings cannot be read

- **WHEN** the shop's settings cannot be read
- **THEN** cards present their purchase action, rather than a control the merchant never chose to offer

#### Scenario: Adding from a card

- **WHEN** a shopper adds a product with no variants from a listing card
- **THEN** that card presents a quantity control showing one
- **AND** the cart holds one of that product

#### Scenario: Stepping up from the card

- **WHEN** a shopper raises the quantity on a card from one to three
- **THEN** the cart holds three of that product on a single line
- **AND** the card shows three

#### Scenario: The card reflects a cart filled earlier

- **WHEN** a shopper whose cart already holds two of a product loads a listing containing it
- **THEN** that product's card presents a quantity control showing two

#### Scenario: Stepping down to nothing

- **WHEN** a shopper lowers the quantity on a card below one
- **THEN** that product is removed from the cart
- **AND** the card presents its purchase action again

#### Scenario: A variable product added through a choice

- **WHEN** a shopper opens the chooser from a card, selects a variant and adds it
- **THEN** that card presents a quantity control for the selected variant

#### Scenario: A listing where nothing has been added

- **WHEN** a shopper views a listing and none of its products are in the cart
- **THEN** every card presents the same purchase action, and none presents a quantity control

#### Scenario: Two variants of one product in the cart

- **WHEN** the cart holds two different variants of the same product
- **THEN** that product's card presents its purchase action rather than a quantity control
- **AND** acting on it leads to the chooser, as it would for any product requiring a choice

### Requirement: A quantity change from a card is responsive and recoverable

A shopper changing a quantity from a card SHALL see the new figure immediately, without waiting for it to be recorded. Repeatedly changing the quantity SHALL remain responsive throughout, and SHALL NOT require the shopper to wait between one change and the next.

Where a change cannot be recorded, the card SHALL return to the last quantity that was, and SHALL tell the shopper the change did not take effect. A failed change SHALL NOT leave the card showing a quantity the cart does not hold.

#### Scenario: Several changes in quick succession

- **WHEN** a shopper raises a quantity from one to five in rapid succession
- **THEN** the card shows each figure as it is chosen, without waiting
- **AND** the cart ends holding five

#### Scenario: A change that cannot be recorded

- **WHEN** a quantity change from a card fails
- **THEN** the card returns to the quantity last confirmed
- **AND** the shopper is told the change did not take effect
