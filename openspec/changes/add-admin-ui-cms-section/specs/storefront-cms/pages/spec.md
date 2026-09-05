## Purpose

Lets a merchant author, publish and edit standalone content pages — About, Terms & Conditions, Refund Policy, FAQ and the like — from the admin panel, and defines how the storefront resolves and renders them without a developer or a redeploy.

## ADDED Requirements

### Requirement: A page is identified by a unique, URL-safe slug
Every page SHALL carry a slug that is unique across all pages, lowercase, and composed only of letters, digits and single hyphens. The system SHALL reject a slug that duplicates an existing page's slug, regardless of the other page's publish status.

#### Scenario: Slug is derived from the title on first save
- **WHEN** an admin creates a page titled "Terms and Conditions" and leaves the slug blank
- **THEN** the page is saved with slug `terms-and-conditions`

#### Scenario: Duplicate slug is rejected
- **WHEN** an admin saves a page with a slug that another page already uses
- **THEN** the save fails with an error naming the conflict, and no page is created or modified

#### Scenario: Malformed slug is rejected
- **WHEN** an admin submits a slug containing spaces, uppercase letters, or a leading or trailing hyphen
- **THEN** the save fails with a validation error describing the allowed format

### Requirement: A page slug cannot shadow an existing storefront route
Because pages resolve at the storefront root (`/<slug>`), the system SHALL refuse to save a page whose slug matches a reserved storefront path segment. The reserved set SHALL be defined server-side so admin and storefront cannot drift.

#### Scenario: Reserved slug is rejected
- **WHEN** an admin tries to save a page with slug `cart`, `checkout`, `products`, `account`, or any other reserved segment
- **THEN** the save fails with an error stating the slug is reserved by the storefront, and the admin is shown the reserved list or a suggested alternative

#### Scenario: Reserved list is served to the admin
- **WHEN** the admin panel opens the page form
- **THEN** it can retrieve the current reserved-slug list from the server rather than relying on a hardcoded copy

### Requirement: Page body is rich text authored through a WYSIWYG editor
A page SHALL store a rich-text body produced by a formatting editor supporting headings, bold, italic, ordered and unordered lists, links, and images. The stored body SHALL be sanitized before it is rendered on the storefront so that script, event-handler and other executable content cannot reach a visitor's browser.

#### Scenario: Formatted content round-trips
- **WHEN** an admin writes a heading, a bulleted list and a link, saves, and reopens the page
- **THEN** the editor shows the same formatting, and the storefront renders it as a heading, a list and a working link

#### Scenario: Injected script is not executed
- **WHEN** a stored page body contains a `<script>` tag or an inline event-handler attribute
- **THEN** the storefront renders the surrounding text without executing that content

#### Scenario: Empty body is rejected
- **WHEN** an admin saves a page with an empty body
- **THEN** the save fails with a validation error

### Requirement: Only published pages are publicly reachable
A page SHALL have a publish status of `DRAFT` or `PUBLISHED`, defaulting to `DRAFT`. The public read path SHALL serve only `PUBLISHED` pages; the admin read path SHALL serve pages of any status.

#### Scenario: Draft page is not public
- **WHEN** a visitor requests `/<slug>` for a page whose status is `DRAFT`
- **THEN** the storefront responds with its 404 page and the page's content is not disclosed

#### Scenario: Published page renders
- **WHEN** a visitor requests `/<slug>` for a `PUBLISHED` page
- **THEN** the storefront renders its title and sanitized body inside the normal site chrome

#### Scenario: Unknown slug
- **WHEN** a visitor requests `/<slug>` for a slug no page uses
- **THEN** the storefront responds with its 404 page

#### Scenario: Admin previews a draft
- **WHEN** an admin opens a `DRAFT` page in the admin panel
- **THEN** its full content is returned and rendered for review

### Requirement: A page carries its own SEO metadata
A page SHALL support an optional meta title and meta description. When either is absent the storefront SHALL fall back to the page title and a truncated plain-text excerpt of the body respectively.

#### Scenario: Explicit metadata is used
- **WHEN** a published page has a meta title and meta description set
- **THEN** the rendered page's document title and meta description match those values

#### Scenario: Metadata falls back
- **WHEN** a published page has no meta title or meta description
- **THEN** the document title is the page title and the meta description is derived from the body text

### Requirement: Pages are managed through full admin CRUD
An authenticated admin SHALL be able to list pages with their slug and status, create a page, edit any field of an existing page, and delete a page. Page writes SHALL be restricted to OWNER and ADMIN roles and recorded in the audit log like other admin mutations.

#### Scenario: Non-admin is refused
- **WHEN** a request without an OWNER or ADMIN session attempts to create, update or delete a page
- **THEN** the request is rejected as unauthorized and no page is written

#### Scenario: Deleting a page removes it from the storefront
- **WHEN** an admin deletes a published page
- **THEN** a subsequent visit to its former `/<slug>` responds with the 404 page

#### Scenario: Page list is searchable
- **WHEN** an admin filters the page list by title or slug text, or by status
- **THEN** only matching pages are listed

### Requirement: Published pages can be linked from navigation
The admin navigation and footer editors SHALL offer published pages as selectable link targets so a merchant can point a menu item at a page without typing its URL by hand.

#### Scenario: Page appears as a link option
- **WHEN** an admin adds a footer link and opens the target picker
- **THEN** every published page is listed, and selecting one stores its `/<slug>` as the link href
