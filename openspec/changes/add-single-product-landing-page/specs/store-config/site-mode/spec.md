## Purpose

Defines the shop-wide toggle between running as a full website and running as a single-product landing page — which landing page is live, what the storefront root serves in each mode, and the guarantees that stop the toggle ever pointing at nothing.

## ADDED Requirements

### Requirement: The shop runs in one of two site modes

The system SHALL hold a single shop-wide site mode with exactly two values, WEBSITE and LANDING_PAGE, defaulting to WEBSITE. An authorised merchant SHALL be able to switch between them from the admin panel, and the change SHALL take effect on the storefront without a redeploy.

#### Scenario: A shop that has never been configured

- **WHEN** the storefront is loaded on an install where no merchant has touched the toggle
- **THEN** the shop is in WEBSITE mode
- **AND** every route behaves exactly as it did before the toggle existed

#### Scenario: Merchant turns the landing page on

- **GIVEN** a shop in WEBSITE mode with a published landing page selected as active
- **WHEN** the merchant switches the mode to LANDING_PAGE and saves
- **THEN** a visitor to the storefront root is served the active landing page
- **AND** no redeploy is required for this to take effect

#### Scenario: Merchant turns the landing page back off

- **GIVEN** a shop in LANDING_PAGE mode
- **WHEN** the merchant switches the mode back to WEBSITE and saves
- **THEN** a visitor to the storefront root is served the normal homepage again

#### Scenario: An unauthorised user tries to switch modes

- **WHEN** a request to change the site mode arrives without owner or admin authorisation
- **THEN** it is rejected
- **AND** the stored mode is unchanged

### Requirement: Landing page mode changes only what the storefront root serves

The system SHALL keep every storefront route other than the root reachable and unchanged in LANDING_PAGE mode. Catalogue, cart, checkout, order tracking, account, blog and content pages SHALL all continue to work, so switching modes breaks no existing link and is reversible with no other consequence.

#### Scenario: Shopper browses the catalogue while the toggle is on

- **GIVEN** a shop in LANDING_PAGE mode
- **WHEN** a shopper opens `/products`, `/products/<handle>`, `/cart` or `/checkout`
- **THEN** each page renders normally with full site chrome

#### Scenario: An existing customer link still works

- **GIVEN** a shop in LANDING_PAGE mode
- **WHEN** a customer opens a link to a content page, a blog post or `/track-order` saved before the toggle was switched on
- **THEN** the page renders as it did before

#### Scenario: A normal order is placed while the toggle is on

- **GIVEN** a shop in LANDING_PAGE mode
- **WHEN** a shopper adds a product to the cart and completes the normal checkout
- **THEN** the order is placed exactly as it would be in WEBSITE mode

### Requirement: The active landing page is chosen explicitly

The system SHALL record which landing page is the active one, chosen by the merchant from the published landing pages. The active landing page SHALL remain reachable at its own `/lp/<slug>` URL in both modes; being active determines only what the storefront root serves.

#### Scenario: Merchant selects the active page

- **WHEN** a merchant selects a published landing page as active and saves
- **THEN** the admin panel shows that page marked as active in the Landing Pages list

#### Scenario: Merchant switches the active page while the toggle is on

- **GIVEN** a shop in LANDING_PAGE mode serving landing page A at the root
- **WHEN** the merchant selects published landing page B as active and saves
- **THEN** the storefront root serves landing page B
- **AND** landing page A is still reachable at its own `/lp/<slug>` URL

#### Scenario: The active page is reachable by its own URL in website mode

- **GIVEN** a shop in WEBSITE mode with a published active landing page
- **WHEN** a visitor opens that page's `/lp/<slug>` URL
- **THEN** the landing page renders

### Requirement: The toggle can never point at nothing

The system SHALL refuse to enter LANDING_PAGE mode unless an active landing page is selected and that page is PUBLISHED. While the shop is in LANDING_PAGE mode, the system SHALL refuse to unpublish or delete the active landing page, and SHALL refuse to clear the active selection. Each refusal SHALL name what the merchant must do first.

#### Scenario: Merchant switches the toggle on with nothing selected

- **WHEN** a merchant tries to switch to LANDING_PAGE mode with no active landing page selected
- **THEN** the change is rejected with a message telling them to select a published landing page first
- **AND** the shop stays in WEBSITE mode

#### Scenario: Merchant selects a draft page as active and switches the toggle on

- **WHEN** a merchant tries to switch to LANDING_PAGE mode with a DRAFT page selected as active
- **THEN** the change is rejected with a message telling them to publish that page first
- **AND** the shop stays in WEBSITE mode

#### Scenario: Merchant tries to unpublish the live landing page

- **GIVEN** a shop in LANDING_PAGE mode
- **WHEN** the merchant tries to set the active landing page back to DRAFT
- **THEN** the change is rejected with a message telling them to switch the shop back to website mode or choose a different active page first
- **AND** the page stays PUBLISHED

#### Scenario: Merchant tries to delete the live landing page

- **GIVEN** a shop in LANDING_PAGE mode
- **WHEN** the merchant tries to delete the active landing page
- **THEN** the deletion is rejected with a message naming why
- **AND** the page still exists

#### Scenario: Merchant deletes a landing page that is selected but not live

- **GIVEN** a shop in WEBSITE mode with landing page A selected as active
- **WHEN** the merchant deletes landing page A
- **THEN** the deletion succeeds
- **AND** the active selection is cleared, so a later attempt to switch to LANDING_PAGE mode is rejected until a page is selected again

### Requirement: The storefront learns the site mode from the shop's public settings

The system SHALL publish the current site mode and the active landing page's slug in the same public settings payload the storefront already reads for its chrome, theme and currency. A storefront that cannot reach the settings API SHALL fall back to WEBSITE mode.

#### Scenario: Storefront reads the settings

- **WHEN** the storefront reads the public settings
- **THEN** the payload states the site mode and, in LANDING_PAGE mode, the active landing page's slug

#### Scenario: Settings API is unreachable

- **WHEN** the storefront cannot reach the settings API
- **THEN** it renders in WEBSITE mode
- **AND** the storefront root serves the normal homepage rather than an error

#### Scenario: Merchant saves the toggle and reloads

- **WHEN** a merchant switches the mode and immediately reloads the storefront root
- **THEN** the new mode is in effect
