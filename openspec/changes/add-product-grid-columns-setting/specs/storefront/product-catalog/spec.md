## ADDED Requirements

### Requirement: Full-width product grids show the merchant's column count on a large screen

On a large screen, the homepage's Best Selling, Featured and New Arrivals rows and the product page's related products SHALL show as many cards across as the merchant's column count. Below the large breakpoint they SHALL stay two across on a phone and three on a tablet whatever the setting.

#### Scenario: Merchant chose four columns

- **WHEN** the column count is 4 and a shopper views the homepage on a large screen
- **THEN** each of the three product rows shows four cards across
- **AND** the related products on a product page show four across

#### Scenario: Default store

- **WHEN** the column count has never been set
- **THEN** every one of these grids shows six cards across on a large screen, as it did before the setting existed

#### Scenario: Phone and tablet are unaffected

- **WHEN** the column count is 4 and a shopper views the homepage on a phone or a tablet
- **THEN** the product rows show two and three cards across respectively, as they do at any column count

#### Scenario: Settings cannot be read

- **WHEN** the storefront renders without having read the store settings
- **THEN** these grids show six cards across on a large screen

#### Scenario: Listings outside the full-width grids are unaffected

- **WHEN** the column count is 4 or 5
- **THEN** the product listing, deals, wishlist and compare pages and the Deal of the Week section keep their own column counts

### Requirement: A product card widens to fill a row with fewer columns

A card SHALL take an equal share of its row, so fewer columns make each card wider and the space between cards SHALL stay the same at every column count. A card's image SHALL be served at a resolution suited to the card's displayed width.

#### Scenario: Fewer columns make larger cards

- **WHEN** the column count changes from 6 to 4 on the same large screen
- **THEN** each card in a homepage product row is wider than before
- **AND** the gap between adjacent cards is unchanged

#### Scenario: Slider cards match grid cards

- **WHEN** a homepage product row uses the slider layout
- **THEN** the slider shows as many cards across as the grid layout would at the same column count, each the same width as a grid card

#### Scenario: A wider card's image is not upscaled

- **WHEN** the column count is 4 on a large screen
- **THEN** the image requested for each card is at least as wide as the card is displayed

### Requirement: Full-width product grids end on a full row

On a large screen, a homepage product row in the grid layout and the related products SHALL hold a whole number of rows at the merchant's column count, so the last line is never a partial row because of the column count chosen. A homepage row SHALL NOT show more products than the twelve it shows today.

#### Scenario: Five columns on the homepage

- **WHEN** the column count is 5 and the catalogue has enough products to fill the row
- **THEN** each homepage product row in the grid layout shows ten products, as two full rows of five

#### Scenario: Four and six columns on the homepage

- **WHEN** the column count is 4 or 6 and the catalogue has enough products
- **THEN** each homepage product row shows twelve products — three rows of four or two rows of six

#### Scenario: Related products fill one row

- **WHEN** the column count is 5 and the product has at least five related products
- **THEN** the product page shows five related products on one row

#### Scenario: Too few products to fill a row

- **WHEN** fewer products exist than one full row needs
- **THEN** the grid shows the products that exist, without padding or placeholders
