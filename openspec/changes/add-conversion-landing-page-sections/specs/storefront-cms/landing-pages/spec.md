## Purpose

What a single-product campaign landing page is: the content a merchant authors on it, the offer mechanics it can carry, and how the storefront renders it as a chrome-free document built to convert ad traffic.

## ADDED Requirements

### Requirement: A landing page may offer a choice of packages
A landing page SHALL be able to offer more than one package of the same campaign — a size, a quantity bundle, a tier — each carrying its own label, its own product, its own price, an optional free-gift line and an optional highlight badge. The shopper SHALL choose exactly one, and the choice SHALL be reflected in every price the page states from that moment on.

A page that declares NO packages SHALL behave exactly as it did before this capability existed: the single bound product, at its own price. Packages are an addition to the page, never a precondition for one.

Exactly one package MAY be marked as preselected. When none is, the page SHALL preselect the first.

#### Scenario: Page offers two packages
- **WHEN** a visitor opens a page offering ৫০০ গ্রাম at ৳৮৪৯ and ১ কেজি at ৳১৫৯৯
- **THEN** both are shown as selectable options with their own prices
- **AND** one of them is already selected

#### Scenario: Shopper switches package
- **WHEN** a visitor selects a different package
- **THEN** the item price, the delivery charge, the grand total and every call-to-action stating a price all update to that package
- **AND** no other selection the visitor has made is reset

#### Scenario: Package carries a free gift
- **WHEN** a package declares a free-gift line
- **THEN** that line is shown with the package, and again in the order summary for the selected package

#### Scenario: Page declares no packages
- **WHEN** a visitor opens a page with no packages configured
- **THEN** the page prices the bound product exactly as it did before packages existed, and no package selector is rendered

#### Scenario: Merchant configures a package against an unavailable product
- **WHEN** a merchant saves a package naming a product that is not purchasable
- **THEN** the save is refused naming the product, rather than publishing a package that cannot be ordered

### Requirement: An offer deadline counts down and expires honestly
A landing page SHALL be able to carry a deadline for its offer. While the deadline is in the future the page SHALL show the remaining time. The countdown SHALL be computed from that one stored instant for every visitor.

Once the deadline has passed the countdown SHALL NOT be rendered, SHALL NOT restart, and SHALL NOT be recomputed per visitor or per session. A page with no deadline SHALL show no countdown.

A merchant MAY additionally configure a page to stop accepting orders once its deadline passes. Where that is set, an order arriving after the deadline SHALL be refused, and the refusal SHALL be decided by the SERVER rather than by the page.

#### Scenario: Countdown before the deadline
- **WHEN** a visitor opens a page whose offer ends in six days
- **THEN** the page shows the time remaining until that instant

#### Scenario: Two visitors see the same deadline
- **WHEN** two visitors open the same page at the same moment from different devices
- **THEN** both see the same remaining time

#### Scenario: Deadline passes while the page is open
- **WHEN** the deadline passes while a visitor has the page open
- **THEN** the countdown stops and is removed rather than restarting

#### Scenario: Visitor returns after the deadline
- **WHEN** a visitor reopens the page after the deadline has passed
- **THEN** no countdown is shown, and no new deadline is generated for them

#### Scenario: Order after an enforced deadline
- **GIVEN** a page configured to stop accepting orders at its deadline
- **WHEN** an order is submitted after that instant
- **THEN** the order is refused, and the refusal says the offer has ended

#### Scenario: Order after a deadline that is not enforced
- **GIVEN** a page with a deadline but no order cut-off configured
- **WHEN** an order is submitted after that instant
- **THEN** the order is accepted, and no countdown is shown on the page

### Requirement: A scarcity indicator reports real progress or is not shown
A landing page SHALL be able to declare a limited run — a number of orders after which an offer ends. Where one is declared, the page SHALL report progress toward it computed from the page's OWN REAL ORDER COUNT.

The reported figure SHALL NOT be fabricated, offset by a configurable starting number, randomised, or derived from anything other than orders actually placed against that page. A merchant SHALL NOT be able to configure a starting count.

Once the run is met the page SHALL stop presenting the offer as available rather than reporting a negative or clamped remainder.

#### Scenario: Progress reflects real orders
- **GIVEN** a page declaring a run of 100 with 65 orders placed against it
- **WHEN** a visitor opens the page
- **THEN** it reports 65 taken and 35 remaining

#### Scenario: A new order moves the figure
- **WHEN** an order is placed against that page
- **THEN** the next visitor sees the count increased by one

#### Scenario: The run is met
- **WHEN** the hundredth order is placed
- **THEN** the page stops presenting the limited offer as available, and shows no negative remainder

#### Scenario: No run declared
- **WHEN** a page declares no limited run
- **THEN** no scarcity indicator is rendered

#### Scenario: Merchant attempts to seed the count
- **WHEN** a merchant tries to save a starting count or a baseline offset for the indicator
- **THEN** no such field is accepted — the figure is derived, never authored

### Requirement: The order form is reachable from every part of the page
A landing page SHALL repeat its call to action down the document — after the hero, after the benefits, and after the content sections — and each SHALL lead to the SAME single order form rather than to a separate one.

On narrow viewports the page SHALL additionally carry a persistent action fixed to the bottom of the viewport, stating the selected package's price and leading to that same form.

The persistent bar SHALL NOT obscure the form itself while the shopper is filling it in.

#### Scenario: Visitor uses a mid-page call to action
- **WHEN** a visitor activates the order button that follows the benefits section
- **THEN** they are taken to the page's one order form, with their selected package still selected

#### Scenario: Sticky bar on a phone
- **WHEN** a visitor scrolls the page on a phone
- **THEN** an order action stays visible at the bottom of the viewport, stating the selected package's price

#### Scenario: Sticky bar while ordering
- **WHEN** the order form is in view
- **THEN** the persistent bar does not cover any part of it

#### Scenario: Sticky bar follows the package choice
- **WHEN** the visitor changes package
- **THEN** the price stated in the persistent bar updates to match

### Requirement: A landing page can offer ordering by phone
A landing page SHALL be able to show a phone number as an alternative to the form, presented as a direct dial action. A page with no number configured SHALL show no such action.

#### Scenario: Phone action offered
- **WHEN** a page carries an order phone number
- **THEN** the page shows a dial action beside the order form

#### Scenario: No number configured
- **WHEN** a page carries no order phone number
- **THEN** no dial action is rendered anywhere on the page

### Requirement: A landing page carries merchant-authored reason and usage sections
A landing page SHALL carry two further merchant-authored repeating lists: reasons the product is different, each with a title and optional supporting text; and ways the product is used, each a short label with an optional icon. Both SHALL be optional, and an empty list SHALL render no section rather than an empty one.

#### Scenario: Both lists authored
- **WHEN** a merchant authors eight reasons and ten usage ideas
- **THEN** both sections render in the page's document order

#### Scenario: Lists left empty
- **WHEN** a merchant authors neither
- **THEN** neither section appears, and no empty heading or spacing is left behind

### Requirement: A customer quote may be a screenshot
A customer quote SHALL be able to carry an image in place of, or in addition to, its typed text — so a merchant can show the message a customer actually sent. A quote with an image and no text SHALL render the image alone; one with text and no image SHALL render as it does today.

#### Scenario: Screenshot quote
- **WHEN** a merchant adds a quote carrying only an image
- **THEN** the image renders in the reviews section with no empty text or rating beside it

#### Scenario: Text quote is unaffected
- **WHEN** a merchant adds a quote with a name, text and a rating and no image
- **THEN** it renders exactly as it did before this change

### Requirement: A landing page can be themed independently of the shop
A landing page SHALL be able to carry its own accent colour and its own display typeface, applied to that page only. A page that sets neither SHALL render in the shop's own theme.

A page's theme SHALL NOT alter the shop's theme, and SHALL NOT persist to any other page.

#### Scenario: Page sets an accent
- **WHEN** a page sets an accent colour
- **THEN** that page's calls to action, badges and highlights use it, and the rest of the storefront is unchanged

#### Scenario: Page sets nothing
- **WHEN** a page sets neither colour nor typeface
- **THEN** it renders in the shop's own theme, as it did before this change

#### Scenario: Accent colour is constrained
- **WHEN** a merchant saves an accent colour that is not a plain colour value
- **THEN** the save is refused, and no value that could carry further styling declarations is stored
