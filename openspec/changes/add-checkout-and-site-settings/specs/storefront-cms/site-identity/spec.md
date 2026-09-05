## Purpose

Owns the store's identity as the outside world sees it — its header and footer logos, its name, its canonical address, and the title and description search engines and social previews read — so that a merchant can establish their brand without a developer editing source and redeploying.

## ADDED Requirements

### Requirement: A merchant can set a header logo and a footer logo independently

The system SHALL let an authorised merchant supply artwork for the storefront header and for the storefront footer as two separate images, uploaded as files rather than entered as URLs. Storefront headers and footers are commonly light-on-dark and dark-on-light respectively, so one image cannot serve both.

#### Scenario: Merchant uploads a header logo

- **WHEN** a merchant uploads an image for the header logo and saves
- **THEN** the storefront header renders that image in place of the text wordmark on every page

#### Scenario: Merchant uploads a footer logo

- **WHEN** a merchant uploads a different image for the footer logo and saves
- **THEN** the storefront footer renders that image, and the header continues to render the header logo

#### Scenario: Only a header logo is set

- **WHEN** a header logo is set and no footer logo is
- **THEN** the footer renders the header logo, so the footer is never left with a blank brand slot

#### Scenario: No logo is set at all

- **WHEN** neither logo is set
- **THEN** both header and footer render the site name as a text wordmark

#### Scenario: Merchant removes a logo

- **WHEN** a merchant clears a previously set logo and saves
- **THEN** the corresponding surface falls back per the rules above, rather than rendering a broken image

#### Scenario: Uploaded file is not an image

- **WHEN** a merchant attempts to upload a file that is not an accepted image type or exceeds the size limit
- **THEN** the upload is rejected with a message naming the constraint, and the previously stored logo is unchanged

### Requirement: The site name is the storefront's wordmark

The system SHALL render the merchant's site name as the storefront wordmark wherever no logo image applies, preserving the existing two-part presentation in which a trailing accent portion is styled distinctly from the leading portion.

#### Scenario: Site name is changed

- **WHEN** a merchant changes the site name and saves
- **THEN** the storefront wordmark, and any place the storefront names the store, reflect the new value

#### Scenario: Site name is left empty

- **WHEN** a save is attempted with an empty site name
- **THEN** it is rejected — a store with no name has no wordmark and no fallback

### Requirement: Meta title and description drive the storefront's document metadata

The system SHALL use merchant-supplied meta title and meta description as the storefront's default document title and description, replacing hardcoded values.

#### Scenario: Meta title and description are set

- **WHEN** a merchant sets both and a visitor loads any storefront page that does not define its own metadata
- **THEN** the page's title and description are the merchant's values

#### Scenario: Meta title is unset

- **WHEN** no meta title is stored
- **THEN** the site name is used as the document title, so the title is never empty or a leftover placeholder

#### Scenario: A page defines its own metadata

- **WHEN** a visitor loads a page that supplies its own title, such as a product or content page
- **THEN** that page's own title takes precedence over the site default

### Requirement: The site URL is the canonical base for absolute links in metadata

The system SHALL let a merchant record the storefront's canonical address, and SHALL use it to resolve metadata that requires an absolute URL, such as canonical links and social preview images.

#### Scenario: Site URL is set

- **WHEN** a site URL is stored and a page emits metadata containing a link or image reference
- **THEN** that reference is emitted as an absolute URL resolved against the stored site URL

#### Scenario: Site URL is not set

- **WHEN** no site URL is stored
- **THEN** metadata is emitted without absolute resolution and the storefront still renders, rather than failing or emitting a malformed URL

#### Scenario: Site URL is malformed

- **WHEN** a save is attempted with a value that is not a valid absolute HTTP or HTTPS URL
- **THEN** it is rejected with a message, and the stored value is unchanged

### Requirement: Copyright text renders in the storefront footer

The system SHALL render merchant-supplied copyright text in the footer, and SHALL render nothing in its place when the text is empty.

#### Scenario: Copyright text is set

- **WHEN** a merchant saves copyright text
- **THEN** the storefront footer renders it

#### Scenario: Copyright text is empty

- **WHEN** the copyright text is empty
- **THEN** the footer omits the line entirely rather than rendering an empty row

### Requirement: Identity fields are publicly readable, and only identity fields are exposed

The system SHALL include the site identity fields in the unauthenticated public settings projection, because the storefront renders them on every page. The projection SHALL remain an explicit allow-list, so a field added to the underlying settings record later is not exposed publicly unless it is deliberately opted in.

#### Scenario: Storefront reads public settings

- **WHEN** an unauthenticated request reads the public store settings
- **THEN** header logo, footer logo, site name, site URL, meta title, meta description and copyright text are present

#### Scenario: A commerce-only setting is added later

- **WHEN** a new field is added to the underlying settings record without being opted into the public projection
- **THEN** it does not appear in the public response

#### Scenario: Public read does not mutate

- **WHEN** an unauthenticated public settings read is served for a store that has never saved settings
- **THEN** defaults are returned and no settings record is created or modified as a side effect

### Requirement: Site identity has one editing surface

The system SHALL present site identity fields on exactly one admin page, so that a given field has a single home and two forms cannot overwrite each other with stale values.

#### Scenario: Merchant edits branding

- **WHEN** a merchant opens the admin section that owns site identity
- **THEN** site name, logos, site URL, meta title, meta description and copyright text are all editable there
- **AND** no other admin page offers those same fields

#### Scenario: A save leaves unrelated settings untouched

- **WHEN** a merchant saves the site identity page
- **THEN** commerce configuration such as currency, tax rate and shipping thresholds is unchanged, having never been sent

#### Scenario: Non-administrator attempts a change

- **WHEN** a request from a staff member who is neither an owner nor an administrator attempts to change site identity
- **THEN** it is rejected and the stored values are unchanged
