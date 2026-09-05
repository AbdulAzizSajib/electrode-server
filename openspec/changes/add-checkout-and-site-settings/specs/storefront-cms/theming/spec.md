## Purpose

Puts the storefront's visual presentation — its colour palette, its typeface, and how wide its content runs — under merchant control, so that values currently compiled into the stylesheet can be changed from the admin panel and take effect without a redeploy.

## ADDED Requirements

### Requirement: A merchant controls the storefront's colour palette

The system SHALL let an authorised merchant set each of the storefront's six presentation colours: page background, foreground text, brand, brand-dark, accent, and sale. Each SHALL be stored and applied as a colour value the browser can render.

#### Scenario: Merchant changes the brand colour

- **WHEN** a merchant sets a new brand colour and saves
- **THEN** every storefront element that uses the brand colour — buttons, links, active states, price highlights — renders in the new colour, without any per-element configuration

#### Scenario: Merchant changes background and foreground

- **WHEN** a merchant sets a new page background and foreground colour and saves
- **THEN** the storefront's page surface and body text render in those colours

#### Scenario: A colour is left unset

- **WHEN** one or more colours have never been configured
- **THEN** the storefront renders that colour's built-in default, which SHALL be the value the storefront ships with today, so an unconfigured store looks unchanged

#### Scenario: An invalid colour is submitted

- **WHEN** a save is attempted with a value that is not a valid hex colour
- **THEN** the save is rejected with a message naming the offending colour, and no part of the palette is changed

#### Scenario: A colour value attempts to carry extra declarations

- **WHEN** a save is attempted with a value that contains characters beyond a hex colour, such as a semicolon followed by further style declarations
- **THEN** it is rejected, so a stored colour cannot inject arbitrary styling into the page

### Requirement: A merchant sets the storefront typeface by pasting a Google Fonts embed

The system SHALL accept, as the font setting, the embed text Google Fonts provides, in any of the forms a merchant is likely to copy: a CSS `@import` statement, an HTML stylesheet `<link>` tag, or the bare stylesheet URL. The system SHALL extract the font family name and the stylesheet URL from that input.

#### Scenario: Merchant pastes a CSS import statement

- **WHEN** a merchant pastes a CSS `@import` statement wrapping a Google Fonts stylesheet URL and saves
- **THEN** the family name and stylesheet URL are extracted, stored, and the storefront renders in that font

#### Scenario: Merchant pastes an HTML link tag

- **WHEN** a merchant pastes an HTML `<link>` tag referencing a Google Fonts stylesheet and saves
- **THEN** the same family name and stylesheet URL are extracted and stored

#### Scenario: Merchant pastes the bare URL

- **WHEN** a merchant pastes only the Google Fonts stylesheet URL and saves
- **THEN** the same family name and stylesheet URL are extracted and stored

#### Scenario: Merchant pastes a multi-word family

- **WHEN** the pasted embed names a family whose name contains spaces
- **THEN** the stored family name is the human-readable name with spaces, not the URL-encoded form

#### Scenario: Input references a host other than Google Fonts

- **WHEN** a save is attempted with an embed whose stylesheet URL points at any host other than the Google Fonts stylesheet host
- **THEN** it is rejected with a message, and the stored font is unchanged

#### Scenario: Input cannot be understood

- **WHEN** a save is attempted with text from which no family name and stylesheet URL can be extracted
- **THEN** it is rejected with a message telling the merchant to paste the embed code from Google Fonts, and the stored font is unchanged

### Requirement: Only the parsed font values are stored and served

The system SHALL store only the extracted family name and stylesheet URL. The merchant's pasted text SHALL NOT be stored verbatim, and SHALL NOT be reproduced into any page the storefront serves.

#### Scenario: Pasted text contains additional markup

- **WHEN** a merchant pastes an embed with extra markup, script, or style declarations surrounding it
- **THEN** only the family name and stylesheet URL are retained, and the surrounding text never reaches a rendered page

#### Scenario: Reading the setting back

- **WHEN** the stored font setting is read
- **THEN** it contains the family name and the stylesheet URL, and the stylesheet URL is one built from validated components rather than a string echoed from input

### Requirement: The configured typeface applies site-wide with a working fallback stack

The system SHALL apply the configured family as the storefront's primary typeface, retaining a fallback stack of system fonts behind it so that text remains readable if the font stylesheet fails to load.

#### Scenario: Font is configured

- **WHEN** a font is configured and a visitor loads any storefront page
- **THEN** body text, headings and controls render in that family

#### Scenario: Font stylesheet fails to load

- **WHEN** the font stylesheet cannot be fetched by the visitor's browser
- **THEN** the page renders in the fallback stack and remains fully readable

#### Scenario: No font is configured

- **WHEN** no font has been configured
- **THEN** the storefront renders in the typeface it ships with today

### Requirement: A merchant controls the storefront's content width

The system SHALL let a merchant choose the maximum width of the storefront's content container from a fixed set of offered widths — 1140px, 1280px, 1440px and 1600px — or a full-width option in which content is not constrained. The chosen width SHALL apply to every surface that is currently width-constrained — header, footer, home sections, listings and detail pages — so the site's width is consistent rather than set per page.

The set is closed rather than a free range because merchant-supplied artwork is proportioned from this value; see "Merchandising artwork keeps its shape at every content width" below.

#### Scenario: Merchant chooses a narrower width

- **WHEN** a merchant selects an offered width narrower than the current one and saves
- **THEN** every width-constrained storefront surface renders at that width, centred, with its existing side padding intact

#### Scenario: Merchant selects full width

- **WHEN** a merchant selects the full-width option
- **THEN** content spans the viewport, still keeping its side padding so text is never flush against the screen edge

#### Scenario: Width is left unset

- **WHEN** no content width has been configured
- **THEN** the storefront renders at the default offered width

#### Scenario: A width that is not offered is submitted

- **WHEN** a save is attempted with a width that is neither one of the offered widths nor the full-width option
- **THEN** it is rejected with a message naming what is permitted, and the stored width is unchanged

#### Scenario: A stored width predates the offered set

- **WHEN** a store's stored width is not one of the offered widths — configured before the set was closed, or written directly to the database
- **THEN** the storefront renders it at the nearest offered width, and the admin presents that width as the selected one rather than leaving the control blank or showing an option that cannot be saved

#### Scenario: Narrow viewport

- **WHEN** the viewport is narrower than the configured content width
- **THEN** content fills the viewport and the page does not scroll horizontally

### Requirement: Merchandising artwork keeps its shape at every content width

The storefront SHALL proportion its merchant-supplied artwork slots — the homepage hero's slider, side tiles and promo tile, and the mid-page banner strip — to the content width, so that a slot's aspect ratio is the same at every offered width and only its rendered size changes. A merchant SHALL NOT have to re-crop or re-upload artwork after changing the content width.

#### Scenario: Merchant changes the content width

- **WHEN** a merchant changes the content width and saves
- **THEN** every artwork slot on the homepage keeps the aspect ratio it had, rendered larger or smaller, and no slot leaves its artwork letterboxed inside empty bands

#### Scenario: Artwork does not match its slot exactly

- **WHEN** artwork whose ratio differs slightly from its slot's is rendered
- **THEN** it fills the slot and is cropped at its edges, rather than being fitted inside the slot against a background

#### Scenario: Full width on an unusually wide screen

- **WHEN** a store is set to full width and a visitor's viewport is wider than any offered fixed width
- **THEN** every artwork slot still holds its aspect ratio, scaled up, and the hero's two columns still share a bottom edge

### Requirement: Theme values are present on first paint

The system SHALL deliver the merchant's theme values with the initial page response, so a visitor never sees the default palette, typeface or width before the merchant's own are applied.

#### Scenario: First page load

- **WHEN** a visitor loads a storefront page for the first time
- **THEN** the merchant's colours, font family and content width are in effect on the first painted frame, with no visible change to default styling afterwards

#### Scenario: Settings cannot be read

- **WHEN** the theme settings cannot be retrieved while rendering a page
- **THEN** the page renders with the built-in defaults and remains fully usable rather than unstyled or failing

### Requirement: Theme is publicly readable and only editable by authorised staff

The system SHALL expose theme values in the unauthenticated public settings projection, since the storefront needs them to render any page. The system SHALL restrict changes to store owners and administrators, and SHALL record each change in the audit trail.

#### Scenario: Storefront reads the theme

- **WHEN** an unauthenticated request reads the public store settings
- **THEN** the colour palette, font family and stylesheet URL, and content width are present

#### Scenario: Non-administrator attempts a change

- **WHEN** a request from a staff member who is neither an owner nor an administrator attempts to change the theme
- **THEN** it is rejected and the stored theme is unchanged

#### Scenario: Change is recorded

- **WHEN** an authorised merchant saves a theme change
- **THEN** the change is recorded in the audit trail with the previous and new values
