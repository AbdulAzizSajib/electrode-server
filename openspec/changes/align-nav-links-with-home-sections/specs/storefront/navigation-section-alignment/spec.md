## Purpose

Keeps the storefront's header navigation honest about what the homepage actually shows. A merchant who switches off a homepage section should not be left advertising that section's destination in their header, and should never have to work out which of two admin screens the leftover link is hiding on.

## ADDED Requirements

### Requirement: A closed map binds navigation targets to homepage sections

The system SHALL define a closed, fixed map from navigation link target to homepage section key. The map SHALL be:

| Link target | Governing section |
|---|---|
| `/blogs` | `BLOG` |
| `/deals` | `DEAL_OF_WEEK` |
| `/products?sort=new` | `NEW_ARRIVALS` |
| `/products?sort=best` | `BEST_SELLING` |

A target in this map is **governed**. Every other target — a custom path, a CMS page, a category, an external URL, or any storefront route not listed — is **ungoverned** and SHALL NOT be affected by any requirement in this capability.

The map SHALL contain only targets that the admin's own link-target picker offers as options, so that a merchant can reach a governed state only by choosing a suggested destination, never by typing a path the system silently reinterprets.

Matching SHALL be exact on the whole target string. Prefix, substring and pattern matching SHALL NOT be used.

#### Scenario: A suggested target is governed

- **WHEN** a merchant picks "Blogs" from the admin's target picker, storing `/blogs`
- **THEN** that link is governed by the `BLOG` section

#### Scenario: A custom target is never governed

- **WHEN** a merchant enters `/our-story`, `https://example.com`, or `/categories/shoes` as a link target
- **THEN** that link is ungoverned and always renders, whatever the homepage configuration is

#### Scenario: A deeper path under a governed route is not governed

- **WHEN** a merchant enters `/blogs/how-we-source-our-coffee` as a link target
- **AND** the `BLOG` section is disabled
- **THEN** the link renders, because `/blogs/how-we-source-our-coffee` is not the governed target `/blogs`

#### Scenario: A near-miss target is not governed

- **WHEN** a merchant enters `/products?sort=newest` or `/blogs/` as a link target
- **THEN** the link is ungoverned and always renders

### Requirement: The storefront hides a navigation link whose governing section is disabled

The storefront SHALL NOT render a header navigation link whose target is governed and whose governing section is disabled in the homepage configuration.

A governed link whose section is enabled SHALL render normally. An ungoverned link SHALL always render.

Suppression SHALL be a render-time decision only. The stored navigation configuration SHALL NOT be modified, and a suppressed link SHALL render again, unchanged and in its original position, as soon as its governing section is enabled.

Suppression SHALL NOT affect the destination itself: the route remains reachable by URL, by search engines, and from anywhere else on the site that links to it.

#### Scenario: Disabling a section hides its header link

- **WHEN** the `BLOG` section is disabled
- **AND** the header navigation contains a link to `/blogs`
- **THEN** that link is not rendered in the header
- **AND** every other navigation link renders in its usual position

#### Scenario: Re-enabling a section restores the link

- **WHEN** a previously disabled `BLOG` section is enabled again
- **THEN** the `/blogs` link renders again, with its stored label, in its stored position

#### Scenario: The stored configuration is untouched

- **WHEN** a merchant disables the `BLOG` section while a `/blogs` link is stored in the navigation
- **THEN** the stored navigation still contains that link, unchanged, with its label and target intact

#### Scenario: The destination still works

- **WHEN** the `BLOG` section is disabled
- **AND** a shopper opens `/blogs` directly
- **THEN** the blog listing renders as it always has

#### Scenario: A shop that has configured nothing hides nothing

- **WHEN** a shop has no stored homepage configuration, so every section is enabled by default
- **THEN** every navigation link renders, governed or not

### Requirement: Desktop and mobile navigation apply the rule identically

The header navigation row and the mobile navigation drawer SHALL apply this rule identically, so that the set of navigation links offered on a small screen and on a large screen never differs.

#### Scenario: Both surfaces agree

- **WHEN** the `DEAL_OF_WEEK` section is disabled
- **AND** the navigation contains a link to `/deals`
- **THEN** that link is absent from both the desktop header row and the mobile navigation drawer

### Requirement: Dropdown children follow the same rule as their parents

A dropdown child whose target is governed and whose governing section is disabled SHALL NOT be rendered.

A parent item SHALL be hidden only when both of the following hold: it has no rendered children remaining, and either its own target is governed-and-disabled or it has no target of its own. A parent with an ungoverned target of its own SHALL continue to render even when all of its children are hidden, since the merchant's link still leads somewhere.

#### Scenario: One child of several is hidden

- **WHEN** a "More" menu has children `/blogs`, `/contact` and `/about`
- **AND** the `BLOG` section is disabled
- **THEN** the menu renders with `/contact` and `/about` only

#### Scenario: A parent survives its children

- **WHEN** a "Shop" item targeting `/products` has a single child `/products?sort=new`
- **AND** the `NEW_ARRIVALS` section is disabled
- **THEN** the "Shop" item renders as a plain link to `/products` with no dropdown

#### Scenario: A parent is hidden with its last child

- **WHEN** an "Offers" item whose own target is `/deals` has a single child `/products?sort=best`
- **AND** both `DEAL_OF_WEEK` and `BEST_SELLING` are disabled
- **THEN** neither the parent nor the child is rendered

### Requirement: The admin reports every suppression on both screens

The admin SHALL show, on the header-links editor, a notice on each navigation row that the storefront is currently suppressing. The notice SHALL name the responsible section in the same words that section carries on the home-sections screen, and SHALL offer a way to reach that screen.

The admin SHALL show, on the home-sections editor, a notice on each disabled section that is currently suppressing at least one navigation link, naming those links.

A suppressed row SHALL remain fully editable. The admin SHALL NOT disable, grey out, remove, or reorder a row because it is suppressed, and SHALL NOT alter what a save writes.

#### Scenario: The header editor explains a suppressed row

- **WHEN** a merchant opens the header-links editor
- **AND** the `BLOG` section is disabled while a `/blogs` link is stored
- **THEN** that row shows a notice saying it is hidden on the storefront because the "Recent blog posts" section is off
- **AND** the notice offers a way to open the home-sections screen

#### Scenario: The sections editor names what it is suppressing

- **WHEN** a merchant opens the home-sections editor
- **AND** the `BLOG` section is disabled while a `/blogs` link is stored in the navigation
- **THEN** the "Recent blog posts" row shows that it is hiding the corresponding header link, naming it

#### Scenario: A suppressed row is still editable

- **WHEN** a merchant edits the label or target of a suppressed navigation row and saves
- **THEN** the save succeeds and stores exactly what they entered, as it would for any other row

#### Scenario: No notice when nothing is suppressed

- **WHEN** every governing section of every stored navigation link is enabled
- **THEN** neither editor shows any suppression notice

### Requirement: The rule has no exceptions

The system SHALL NOT provide any per-link override of this behavior. A stored navigation link SHALL NOT carry a flag that exempts it from suppression, and there SHALL be no setting that disables the rule as a whole.

#### Scenario: Suppression cannot be overridden

- **WHEN** a merchant wants a `/blogs` link shown while the `BLOG` section is off
- **THEN** there is no setting that achieves it
- **AND** the only available action is to enable the section, or to point the link at an ungoverned target

### Requirement: Chrome remains unaddressable from the homepage configuration

The homepage configuration SHALL continue to govern only the composition of the homepage. It SHALL NOT be able to switch off, reorder, or otherwise address the header, the footer, the announcement bar, the cart drawer or the mobile navigation as such.

This capability narrows that boundary in exactly one respect and no further: an individual navigation link with a governed target follows its section's enabled flag. Everything else about site-wide chrome is unaffected — including footer links, announcement-bar links, and the header's own fixed controls, none of which SHALL be suppressed by any homepage section.

#### Scenario: Chrome itself cannot be switched off

- **WHEN** every homepage section is disabled
- **THEN** the header, footer, announcement bar and mobile navigation still render on every route
- **AND** only the homepage's own sections are absent

#### Scenario: Footer and announcement links are unaffected

- **WHEN** the `BLOG` section is disabled
- **AND** a `/blogs` link exists in a footer column and in the announcement bar
- **THEN** both of those links still render

#### Scenario: A fixed header control is unaffected

- **WHEN** the `DEAL_OF_WEEK` section is disabled
- **AND** the header renders its own fixed "Today's Offers" control, which is not part of the merchant's navigation
- **THEN** that control still renders, because it is chrome rather than a configured navigation link
