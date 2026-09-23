## Purpose

Which blocks the storefront homepage is composed of, and in what order. The merchant decides both — every section can be switched off and the whole page reordered — without deleting any of the content those sections draw on, so a layout decision never costs data.

## ADDED Requirements

### Requirement: The homepage is composed from a closed registry of sections

The system SHALL define a closed set of addressable homepage sections, each identified by a stable key. The set SHALL be:

| Key | Section |
|---|---|
| `HERO` | The hero banner block |
| `BRAND_BAR` | The scrolling brand logo strip |
| `FEATURED_CATEGORIES` | The category grid |
| `BEST_SELLING` | Best-selling products |
| `MID_BANNERS` | The three-across promo strip |
| `FEATURED_PRODUCTS` | Featured products |
| `PERKS_BAR` | The delivery/returns/support perks strip |
| `DEAL_OF_WEEK` | The countdown deal block |
| `NEW_ARRIVALS` | Newest products |
| `TESTIMONIALS` | Customer testimonials |
| `BLOG` | Recent blog posts |

A section's key SHALL NOT change once released, since stored merchant configurations refer to sections by key.

The registry SHALL define a default order and a default enabled state for every section. The defaults SHALL be every section enabled, in the order listed above, which is the order the homepage renders in today.

Sections outside this registry SHALL NOT be addressable. Site-wide chrome — the header, the footer, the announcement bar, the cart drawer and the mobile navigation — is rendered on every route and is NOT part of this registry.

#### Scenario: A shop that has never configured its homepage

- **WHEN** a shop has no stored homepage configuration
- **THEN** the homepage renders all eleven sections in the registry's default order

#### Scenario: Chrome is not addressable

- **WHEN** a homepage configuration is read
- **THEN** it governs only the eleven registry sections
- **AND** the header, footer, announcement bar and mobile navigation render exactly as they do on every other route, unaffected

### Requirement: A merchant sets both which sections appear and in what order

The system SHALL hold a homepage configuration consisting of an ordered list of sections, each carrying an enabled flag. The order of the list SHALL be the order in which the storefront renders the enabled sections.

A merchant with store administration permission SHALL be able to enable or disable any individual section and to move any section to any position, independently of one another. Disabling a section SHALL NOT change its position in the order, so re-enabling it returns it to where the merchant left it.

Changing the configuration SHALL NOT create, modify or delete any of the content the sections draw on — products, banners, categories, testimonials or blog posts.

#### Scenario: Disabling a single section

- **WHEN** a merchant disables the blog section and saves
- **THEN** the homepage renders every other enabled section in its configured order, with no blog section
- **AND** the shop's blog posts remain published and reachable at their own URLs

#### Scenario: Reordering sections

- **WHEN** a merchant moves best-selling products above the hero and saves
- **THEN** the homepage renders best-selling products first and the hero second

#### Scenario: Position is kept while disabled

- **WHEN** a merchant disables a section, saves, later re-enables it, and saves again
- **THEN** the section reappears at the same position it occupied before it was disabled

#### Scenario: Enabling and ordering are independent

- **WHEN** a merchant reorders sections without changing any enabled flag
- **THEN** exactly the same set of sections renders, in the new order

#### Scenario: An unauthorised change

- **WHEN** a signed-in user whose role does not permit store administration tries to change the homepage configuration
- **THEN** the change is refused and the stored configuration is left as it was

### Requirement: A stored configuration is reconciled against the registry on read

The system SHALL reconcile every stored homepage configuration against the current section registry before it is used, so that a configuration saved against one release of the registry remains usable against a later one.

Reconciliation SHALL:

- **drop** any entry whose key is not in the registry;
- **append** any registry section absent from the stored list, enabled, positioned according to the registry's default order relative to the sections around it;
- **preserve** the stored relative order and enabled flag of every entry whose key is in the registry;
- **collapse** duplicate keys to the first occurrence.

Reconciliation SHALL NOT require a data migration when a section is added to or removed from the registry, and SHALL NOT discard a merchant's saved order because of such a change.

#### Scenario: A section added in a later release

- **WHEN** a stored configuration predates a newly added section
- **THEN** the new section renders, enabled, in its registry-default position
- **AND** the merchant's existing order and enabled flags for all other sections are unchanged

#### Scenario: A section removed from the registry

- **WHEN** a stored configuration names a section that the registry no longer contains
- **THEN** that entry is ignored
- **AND** the remaining sections render in their stored order without error

#### Scenario: A malformed stored configuration

- **WHEN** the stored configuration cannot be interpreted as an ordered list of registry sections
- **THEN** the homepage renders the registry's full default list rather than failing to render

#### Scenario: Duplicate keys

- **WHEN** a stored configuration names the same section more than once
- **THEN** that section renders exactly once, at its first position

### Requirement: Enabled and non-empty are independent conditions

The system SHALL render a section only when it is both enabled by the merchant AND has content to show. An enabled section with no content SHALL be omitted entirely, including its heading.

Being enabled SHALL NOT be treated as an assertion that a section has content, and having content SHALL NOT cause a disabled section to render.

#### Scenario: Enabled with no content

- **WHEN** the testimonials section is enabled and the shop has published no testimonials
- **THEN** the homepage omits the testimonials section entirely, including its heading

#### Scenario: Disabled with content

- **WHEN** the blog section is disabled and the shop has published blog posts
- **THEN** the homepage omits the blog section

#### Scenario: Enabled with content

- **WHEN** a section is enabled and has content
- **THEN** the section renders in its configured position

### Requirement: A disabled section costs no data fetch

The system SHALL NOT request the data backing a disabled section when rendering the homepage. Disabling a section SHALL reduce the work the homepage performs, not merely hide its output.

A failure while fetching one enabled section's data SHALL NOT prevent the other enabled sections from rendering.

#### Scenario: Disabled sections are not fetched

- **WHEN** the homepage renders with the deal-of-the-week and blog sections disabled
- **THEN** no request is made for the deal campaign or for blog posts

#### Scenario: All product sections disabled

- **WHEN** every section backed by a product query is disabled
- **THEN** no product query is issued while rendering the homepage

#### Scenario: One section's data fails

- **WHEN** the data for one enabled section cannot be fetched
- **THEN** that section is omitted and every other enabled section still renders

### Requirement: A homepage with no enabled sections is a valid configuration

The system SHALL accept a configuration in which every section is disabled, and SHALL NOT refuse the save or substitute defaults for it.

In that state the homepage SHALL render its site-wide chrome with no sections between them, rather than an error page or a partially-default homepage. Before saving such a configuration, the merchant SHALL be told that the homepage will have no sections.

#### Scenario: Saving with everything off

- **WHEN** a merchant disables every section and saves
- **THEN** the configuration is stored as given
- **AND** the merchant is told beforehand that the homepage will have no sections

#### Scenario: Rendering with everything off

- **WHEN** the homepage renders with every section disabled
- **THEN** the header and footer render as on every other route, with no sections between them
- **AND** the page returns successfully rather than as an error

### Requirement: The configuration is published to the storefront and takes effect without a redeploy

The system SHALL publish the reconciled homepage configuration on the same public settings payload the storefront already reads on every page, so that no additional request is needed to decide what the homepage renders.

A saved change SHALL take effect on the storefront without a redeploy, on the same invalidation path as the shop's other presentation settings. In the absence of that invalidation, the change SHALL still take effect within the settings payload's own staleness bound.

#### Scenario: A save reaches the storefront

- **WHEN** a merchant saves a homepage configuration
- **THEN** a subsequent visit to the homepage renders the new configuration without a redeploy

#### Scenario: Invalidation does not arrive

- **WHEN** the storefront's cache invalidation is unavailable
- **THEN** the new configuration still takes effect once the settings payload's staleness bound has elapsed

### Requirement: The homepage renders in full when settings cannot be read

The system SHALL render the registry's full default section list when the shop's settings cannot be read at all.

A settings outage SHALL NOT be allowed to produce an empty or truncated homepage, because a shopper cannot distinguish a stripped homepage from a merchant's deliberate configuration.

#### Scenario: Settings unavailable

- **WHEN** the shop's settings cannot be read
- **THEN** the homepage renders all registry sections in their default order, subject to each having content

### Requirement: The merchant edits the configuration from one screen

The system SHALL provide a single administration screen presenting every registry section as an ordered list, showing for each its name, a description of what it shows, its enabled state, and a control to move it within the order.

The screen SHALL:

- show the effective configuration on load, so that an unconfigured shop shows what its homepage is actually doing rather than showing every section as off;
- warn before navigating away with unsaved changes;
- leave the merchant's edits intact when a save fails, and state why it failed;
- write only the homepage configuration, leaving every other store setting untouched.

#### Scenario: An unconfigured shop

- **WHEN** a merchant opens the screen for a shop with no stored configuration
- **THEN** every section is shown enabled, in the registry's default order

#### Scenario: Leaving with unsaved changes

- **WHEN** a merchant reorders sections and navigates away without saving
- **THEN** they are warned that their changes will be lost

#### Scenario: A failed save

- **WHEN** a save fails
- **THEN** the merchant's edits remain on screen
- **AND** the reason for the failure is shown

#### Scenario: Other settings are untouched

- **WHEN** a merchant saves the homepage configuration
- **THEN** no other store setting is changed
