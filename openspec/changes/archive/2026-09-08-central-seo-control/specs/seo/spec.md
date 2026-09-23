## Purpose

Gives the store one place to own search-engine presence: global SEO defaults, indexing and robots policy, sitemap generation, structured data, search-engine verification, and per-record meta overrides across every content type — and defines how the storefront renders that configuration into HTML.

## ADDED Requirements

### Requirement: Centralized SEO administration surface

The admin panel SHALL expose a single top-level `SEO` navigation section, visible only to users with the `OWNER` or `ADMIN` role, from which every SEO setting described in this capability can be reached. No SEO setting defined here SHALL require the administrator to visit a non-SEO settings screen to discover it.

#### Scenario: Owner opens the SEO menu

- **WHEN** a signed-in user with role `OWNER` or `ADMIN` views the admin sidebar
- **THEN** a `SEO` section is listed containing entries for General, Indexing, Structured Data, Verification, and Page SEO

#### Scenario: Non-privileged role is denied

- **WHEN** a signed-in user without the `OWNER` or `ADMIN` role attempts to open any `SEO` page by direct URL
- **THEN** the page is not rendered and the user is redirected away, and any SEO API request made with that session is rejected with `403`

#### Scenario: SEO settings no longer live on the Site Setting page

- **WHEN** an administrator opens the Site Setting page
- **THEN** no SEO fields are presented there, and the canonical site URL, default meta title, and default meta description are editable only from `SEO → General`

### Requirement: Global SEO defaults

The system SHALL persist a global SEO configuration comprising: canonical site URL, page title template, default meta title, default meta description, default Open Graph image URL, default Twitter card type, and default Twitter site handle. Saving a subset of these fields SHALL leave the remaining fields unchanged.

#### Scenario: Administrator saves global defaults

- **WHEN** an administrator submits `SEO → General` with a canonical site URL, title template, default meta title, and default meta description
- **THEN** the values are persisted and returned on the next read of the SEO configuration

#### Scenario: Partial save preserves untouched fields

- **WHEN** an administrator saves only the default Open Graph image URL
- **THEN** the previously stored title template, meta title, and meta description are unchanged

#### Scenario: Invalid canonical site URL is rejected

- **WHEN** an administrator submits a canonical site URL that is not an absolute `http://` or `https://` URL
- **THEN** the request is rejected with a validation error naming the field, and no configuration is persisted

#### Scenario: Configuration has never been set

- **WHEN** the SEO configuration is read before any administrator has saved it
- **THEN** a complete default configuration is returned with every field populated or explicitly null, and no error is raised

### Requirement: Resolved metadata for every storefront page

Every storefront page SHALL render a title and meta description resolved by the following precedence: the record's own SEO title/description when set, otherwise the record's display title and derived summary, otherwise the global default meta title/description. The resolved title SHALL be rendered through the configured title template, and no storefront page SHALL render a hardcoded brand name that ignores the store's configured name.

#### Scenario: Record-level SEO title wins

- **WHEN** a product with a non-empty SEO title is requested on the storefront
- **THEN** the rendered page title is that SEO title formatted through the title template

#### Scenario: Falls back to the record's display title

- **WHEN** a product with an empty SEO title is requested
- **THEN** the rendered page title is the product's name formatted through the title template

#### Scenario: Falls back to global defaults

- **WHEN** a page with neither a record-level title nor a display title is requested
- **THEN** the rendered page title is the global default meta title

#### Scenario: Title template is applied

- **WHEN** the title template is `%s | Acme` and a page resolves to the title `Laptops`
- **THEN** the rendered `<title>` is `Laptops | Acme`

#### Scenario: Store name replaces hardcoded branding

- **WHEN** the configured store name is changed and a static storefront page such as the cart is requested
- **THEN** the rendered title reflects the new store name

### Requirement: Canonical, Open Graph, and Twitter tags

Every storefront page SHALL emit a canonical link resolved against the configured canonical site URL, together with Open Graph and Twitter card tags derived from that page's resolved title, description, and image. When a page has no image of its own, the default Open Graph image SHALL be used.

#### Scenario: Canonical link is absolute

- **WHEN** the canonical site URL is `https://shop.example.com` and the storefront renders the path `/products/laptop`
- **THEN** the page emits a canonical link of `https://shop.example.com/products/laptop`

#### Scenario: Open Graph tags are present

- **WHEN** any storefront page is rendered
- **THEN** it emits Open Graph title, description, URL, type, and image tags consistent with its resolved metadata

#### Scenario: Twitter card falls back to defaults

- **WHEN** a page has no image of its own and a default Open Graph image is configured
- **THEN** the emitted Twitter card uses the configured card type, site handle, and the default image

#### Scenario: Canonical site URL is unset

- **WHEN** no canonical site URL is configured and a storefront page is rendered
- **THEN** the page renders successfully without canonical or absolute-URL tags rather than failing

### Requirement: Indexing and robots policy

The system SHALL let an administrator control indexing through a global `noindex` switch, per-route-group indexing directives, and additional custom `robots.txt` rules. The storefront SHALL emit per-page robots directives matching that policy and SHALL serve a `robots.txt` generated from it.

#### Scenario: Global noindex overrides everything

- **WHEN** the global `noindex` switch is enabled
- **THEN** every storefront page emits `noindex, nofollow` and the served `robots.txt` disallows all crawling, regardless of per-route-group settings

#### Scenario: Private route groups are excluded by default

- **WHEN** the SEO configuration has never been customized and an account, cart, checkout, or wishlist page is rendered
- **THEN** that page emits `noindex, nofollow`

#### Scenario: Public pages are indexable by default

- **WHEN** the SEO configuration has never been customized and a product, category, blog, or content page is rendered
- **THEN** that page emits `index, follow`

#### Scenario: robots.txt reflects configuration

- **WHEN** a crawler requests `/robots.txt` and the global `noindex` switch is disabled
- **THEN** the response is a valid `robots.txt` containing the configured disallow rules, any custom rules, and an absolute link to the sitemap

### Requirement: Generated sitemap

The storefront SHALL serve a sitemap listing every published, indexable Product, Category, Page, Blog Post, and Landing Page, each with an absolute URL and its last-modified timestamp. An administrator SHALL be able to include or exclude each content type. Records that are unpublished, or whose route group is marked `noindex`, SHALL be omitted.

#### Scenario: Sitemap lists published content

- **WHEN** a crawler requests the sitemap and all content types are enabled
- **THEN** the response contains one absolute URL entry per published Product, Category, Page, Blog Post, and Landing Page, each carrying a last-modified timestamp

#### Scenario: Disabled content type is excluded

- **WHEN** an administrator disables Blog Posts for the sitemap and a crawler requests the sitemap
- **THEN** no blog post URLs appear, and the other content types are unaffected

#### Scenario: Unpublished records are excluded

- **WHEN** a product exists in draft or unpublished state
- **THEN** its URL does not appear in the sitemap

#### Scenario: Global noindex empties the sitemap

- **WHEN** the global `noindex` switch is enabled and a crawler requests the sitemap
- **THEN** the sitemap contains no URL entries

### Requirement: Structured data

The system SHALL let an administrator supply organization details — legal name, logo URL, contact details, and social profile URLs — and independently toggle emission of Organization, Product, Article, and Breadcrumb structured data. When a type is enabled, the storefront SHALL emit valid JSON-LD for it on the relevant pages; when disabled, it SHALL emit none.

#### Scenario: Organization schema on every page

- **WHEN** Organization structured data is enabled and any storefront page is rendered
- **THEN** the page includes a JSON-LD `Organization` block carrying the configured legal name, logo, and social profile URLs

#### Scenario: Product schema on a product page

- **WHEN** Product structured data is enabled and a product detail page is rendered
- **THEN** the page includes a JSON-LD `Product` block with the product's name, image, description, price, currency, and availability

#### Scenario: Article schema on a blog post

- **WHEN** Article structured data is enabled and a blog post is rendered
- **THEN** the page includes a JSON-LD `Article` block with headline, publication date, and last-modified date

#### Scenario: Breadcrumb schema

- **WHEN** Breadcrumb structured data is enabled and a product or category page is rendered
- **THEN** the page includes a JSON-LD `BreadcrumbList` block describing the path from the site root to that page

#### Scenario: Disabled type emits nothing

- **WHEN** Product structured data is disabled and a product detail page is rendered
- **THEN** the page contains no JSON-LD `Product` block

### Requirement: Search engine verification tokens

The system SHALL let an administrator store search-engine verification tokens, and the storefront SHALL emit a corresponding verification `<meta>` tag for each token that is set. Tokens left empty SHALL emit no tag.

#### Scenario: Verification tag is emitted

- **WHEN** a Google Search Console verification token is saved and any storefront page is rendered
- **THEN** the page head contains a Google site-verification meta tag carrying that token

#### Scenario: Empty token emits nothing

- **WHEN** no verification token is configured
- **THEN** the rendered page head contains no verification meta tag

### Requirement: Cross-content SEO overview

The `SEO → Page SEO` screen SHALL present a single paginated, searchable list of every SEO-bearing record across Products, Categories, Pages, Blog Posts, and Landing Pages. Each row SHALL show the record's content type, title, public path, resolved meta title and description, and a health indicator flagging missing or out-of-range values. The administrator SHALL be able to edit a record's SEO title and description from this screen, and the saved values SHALL be identical to those edited on that record's own edit form.

#### Scenario: Overview lists records from every content type

- **WHEN** an administrator opens `SEO → Page SEO`
- **THEN** the list contains rows for Products, Categories, Pages, Blog Posts, and Landing Pages, each showing content type, resolved meta title, and resolved meta description

#### Scenario: Health indicator flags a missing description

- **WHEN** a product has no SEO description and no description to fall back on
- **THEN** its row is flagged as missing a description

#### Scenario: Health indicator flags an over-long title

- **WHEN** a record's resolved meta title exceeds the recommended display length
- **THEN** its row is flagged as too long

#### Scenario: Editing from the overview updates the record

- **WHEN** an administrator edits a product's SEO title from the overview and saves
- **THEN** the product's stored SEO title is updated, the same value appears on the product's own edit form, and the storefront product page renders the new title

#### Scenario: Filtering by content type

- **WHEN** an administrator filters the overview to Blog Posts
- **THEN** only blog post rows are listed

### Requirement: Per-record SEO fields on content edit forms

Every content type that stores SEO fields — Product, Category, Page, Blog Post, and Landing Page — SHALL expose those fields for editing on its own admin edit form in addition to the SEO overview. Values saved from either location SHALL be the same stored fields.

#### Scenario: Product form exposes SEO fields

- **WHEN** an administrator edits a product
- **THEN** the form presents editable SEO title and SEO description fields, and saving persists them

#### Scenario: Category form exposes SEO fields

- **WHEN** an administrator edits a category
- **THEN** the form presents editable SEO title and SEO description fields, and saving persists them

#### Scenario: Both entry points agree

- **WHEN** an administrator saves a SEO description on a category's own edit form and then opens the SEO overview
- **THEN** the overview shows that same description for that category

### Requirement: SEO changes reach the storefront

Saving any SEO configuration or per-record SEO field SHALL cause the storefront to serve the updated metadata without a redeploy. A storefront page SHALL never fail to render because SEO configuration is unavailable.

#### Scenario: Saved configuration propagates

- **WHEN** an administrator saves a new default meta description and a storefront page is subsequently requested
- **THEN** the served page reflects the new description

#### Scenario: Configuration source is unavailable

- **WHEN** the SEO configuration cannot be retrieved and a storefront page is requested
- **THEN** the page renders using built-in fallback metadata rather than returning an error
