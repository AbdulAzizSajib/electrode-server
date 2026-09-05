## Purpose

Defines the single-product landing page a merchant authors for an ad campaign — what content it holds, how it is created, published and retired in the admin panel, and how the storefront renders it as a self-contained document with no site chrome around it.

## ADDED Requirements

### Requirement: A landing page is authored in the admin panel and bound to one product

The system SHALL let an authorised merchant create, edit, duplicate and delete landing pages from a dedicated admin screen. Each landing page SHALL be bound to exactly one existing product, which supplies the price, stock and tax rule the page sells against. A landing page SHALL NOT be creatable without a product.

#### Scenario: Merchant creates a landing page

- **WHEN** a merchant opens the Landing Pages screen, creates a page, selects a product and saves
- **THEN** the landing page is stored and appears in the Landing Pages list
- **AND** the list shows its title, its bound product, its slug, its status and when it was last edited

#### Scenario: Merchant tries to save without choosing a product

- **WHEN** a merchant saves a landing page with no product selected
- **THEN** the save is rejected with a message naming the missing product
- **AND** no landing page is created

#### Scenario: Merchant duplicates a page to start the next campaign

- **WHEN** a merchant duplicates an existing landing page
- **THEN** a new DRAFT landing page is created carrying the same content and a distinct slug
- **AND** the original page is unchanged

#### Scenario: Bound product is deleted

- **GIVEN** a landing page bound to a product
- **WHEN** an attempt is made to delete that product
- **THEN** the deletion is rejected with a message naming the landing pages that sell it

### Requirement: Each landing page has its own address on the storefront

The system SHALL serve every PUBLISHED landing page at its own URL under `/lp/<slug>`, in both site modes. Slugs SHALL be unique across landing pages, SHALL match the same lowercase-hyphen form the storefront's content pages use, and SHALL be editable by the merchant.

#### Scenario: Visitor opens a published landing page directly

- **WHEN** a visitor requests `/lp/<slug>` for a PUBLISHED landing page
- **THEN** the landing page is rendered

#### Scenario: Visitor opens a draft or unknown landing page

- **WHEN** a visitor requests `/lp/<slug>` for a DRAFT landing page or a slug that does not exist
- **THEN** the storefront responds with its not-found page
- **AND** no landing page content is disclosed

#### Scenario: Merchant reuses a slug

- **WHEN** a merchant saves a landing page with a slug another landing page already uses
- **THEN** the save is rejected naming the conflict
- **AND** the existing page keeps its slug

#### Scenario: Merchant enters a malformed slug

- **WHEN** a merchant enters a slug containing spaces, uppercase letters or punctuation
- **THEN** the save is rejected with a message stating the accepted form

### Requirement: A landing page carries the content a campaign page needs

The system SHALL let a merchant author, per landing page: a hero headline, an optional subheadline and an optional badge label; an ordered media gallery of images and videos; a rich-text description body; a list of highlight bullets; a list of question-and-answer rows; a list of customer quotes; a list of trust badges; and an after-order thank-you heading and message. Every one of these except the headline SHALL be optional, and a section with no content SHALL be omitted from the rendered page rather than rendered empty.

#### Scenario: Merchant authors the full page

- **WHEN** a merchant fills in every content section and publishes
- **THEN** the rendered landing page shows each section in the authored order

#### Scenario: Merchant leaves sections empty

- **GIVEN** a landing page with a headline, one image and an order form but no FAQ, highlights or quotes
- **WHEN** a visitor opens it
- **THEN** the page renders without empty FAQ, highlight or quote sections and without placeholder text

#### Scenario: Merchant reorders the media gallery

- **WHEN** a merchant reorders the images and videos in the gallery and saves
- **THEN** the storefront gallery presents them in the new order
- **AND** the first item is the one shown before any interaction

#### Scenario: Merchant adds a video

- **WHEN** a merchant adds a video to the gallery
- **THEN** the storefront plays it in place within the gallery
- **AND** it does not autoplay with sound

### Requirement: Landing page copy is whatever language the merchant writes

The system SHALL treat every merchant-authored string on a landing page as content, not as a translatable key, so a page authored in Bangla renders in Bangla with no further configuration. A newly created landing page SHALL be pre-filled with Bangla defaults for its order-form labels, delivery-zone labels and submit button, which the merchant may overwrite.

#### Scenario: Merchant creates a page and publishes it unchanged

- **WHEN** a merchant creates a landing page, selects a product, writes a headline and publishes without editing the form labels
- **THEN** the rendered order form reads `নাম`, `মোবাইল নম্বর` and `ঠিকানা`
- **AND** its submit button reads `অর্ডার কনফার্ম করুন`

#### Scenario: Merchant writes the page in English

- **WHEN** a merchant replaces the seeded Bangla labels with English ones and saves
- **THEN** the rendered page shows the English labels
- **AND** no Bangla text remains on the page

### Requirement: A landing page is published or draft

The system SHALL give every landing page a status of DRAFT or PUBLISHED, defaulting to DRAFT on creation. Only PUBLISHED pages SHALL be reachable on the storefront. A merchant SHALL be able to move a page between the two states at any time, subject to the site-mode invariants in `store-config/site-mode`.

#### Scenario: Merchant publishes a page

- **WHEN** a merchant sets a DRAFT landing page to PUBLISHED
- **THEN** the page becomes reachable at `/lp/<slug>`

#### Scenario: Merchant unpublishes a page

- **GIVEN** a PUBLISHED landing page that is not the active landing page
- **WHEN** a merchant sets it back to DRAFT
- **THEN** requests to `/lp/<slug>` return the storefront's not-found page

#### Scenario: Merchant previews a draft

- **WHEN** an authenticated merchant opens the preview link for a DRAFT landing page from the admin panel
- **THEN** the page renders as it would once published
- **AND** an unauthenticated visitor opening the same link receives the not-found page

### Requirement: A landing page renders without site chrome

The system SHALL render a landing page as a self-contained document: no site header, no navigation, no announcement bar, no footer, no cart drawer, no compare bar and no mobile bottom navigation. The page SHALL still inherit the shop's configured theme colours, fonts and currency format so it looks like the same business.

#### Scenario: Visitor opens a landing page

- **WHEN** a visitor opens a published landing page
- **THEN** no site header, footer, navigation, cart drawer, compare bar or mobile bottom navigation is present anywhere in the document
- **AND** prices on the page are written in the shop's configured currency symbol, position and decimal places

#### Scenario: Visitor opens an ordinary storefront page in the same session

- **WHEN** the visitor navigates from the landing page to `/products`
- **THEN** the full site chrome is present as usual

#### Scenario: Merchant changes the shop theme

- **GIVEN** a published landing page
- **WHEN** the merchant changes the shop's brand colour and font
- **THEN** the landing page renders with the new colour and font

### Requirement: A landing page carries its own search metadata and optional campaign pixel

The system SHALL let a merchant set a meta title, meta description and social share image per landing page, falling back to the page headline and the bound product's imagery when unset. The system SHALL let a merchant record a Facebook Pixel id per landing page, SHALL accept only a numeric id, and SHALL use it solely to initialise the pixel on that page — merchant-supplied text SHALL NOT reach the page as markup or script.

#### Scenario: Merchant sets page metadata

- **WHEN** a merchant sets a meta title and description and publishes
- **THEN** the landing page's document title and description are the authored ones

#### Scenario: Merchant leaves metadata unset

- **WHEN** a visitor opens a landing page with no meta title set
- **THEN** the document title is the page's headline
- **AND** the document description is derived from the page's own content, never left empty

#### Scenario: Merchant sets a pixel id

- **WHEN** a merchant saves a numeric Facebook Pixel id and a visitor opens the page
- **THEN** the pixel is initialised with that id and a page-view event is recorded

#### Scenario: Merchant enters a non-numeric pixel id

- **WHEN** a merchant saves a pixel id containing anything other than digits
- **THEN** the save is rejected
- **AND** the previously stored id, if any, is unchanged

### Requirement: A landing page reflects the bound product's price and availability

The system SHALL display the bound product's current price on the landing page, and its compare-at price as a struck-through "regular" price when one is set. A landing page SHALL NOT be able to define a price of its own. When the bound product is out of stock or not ACTIVE, the page SHALL say so and SHALL NOT present a submittable order form.

#### Scenario: Product has a compare-at price

- **GIVEN** a product priced 990 with a compare-at price of 1500
- **WHEN** a visitor opens its landing page
- **THEN** the page shows 990 as the price and 1500 struck through

#### Scenario: Merchant changes the product price

- **WHEN** a merchant edits the bound product's price
- **THEN** the landing page shows the new price without the landing page being edited

#### Scenario: Product goes out of stock

- **GIVEN** a published landing page whose product has no available stock
- **WHEN** a visitor opens it
- **THEN** the page states the product is unavailable
- **AND** the order form cannot be submitted

#### Scenario: Product is set to draft

- **GIVEN** a published landing page whose product is no longer ACTIVE
- **WHEN** a visitor opens it
- **THEN** the page states the product is unavailable
- **AND** the order form cannot be submitted
