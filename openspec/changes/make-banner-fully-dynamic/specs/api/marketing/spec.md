## MODIFIED Requirements

### Requirement: Only active, in-window banners are publicly served
The public banner listing SHALL exclude banners that are not `ACTIVE` or are outside their `startsAt`/`endsAt` window, ordered by `sortOrder`. The listing SHALL accept an optional `placement` filter and, when given one, return only banners of that placement, ordered by `sortOrder` within it.

#### Scenario: Scheduled banner not yet live
- **WHEN** a `Banner` has `status: ACTIVE` but `startsAt` in the future
- **THEN** it does not appear in the public banner listing yet

#### Scenario: Listing filtered by placement
- **WHEN** a client requests the public banner listing with a `placement` of `HEADER`
- **THEN** only active, in-window banners whose placement is `HEADER` are returned, ordered by `sortOrder` ascending

#### Scenario: Listing without a placement filter
- **WHEN** a client requests the public banner listing with no `placement`
- **THEN** all active, in-window banners are returned regardless of placement, ordered by `sortOrder` ascending

#### Scenario: Unknown placement value rejected
- **WHEN** a client requests the public banner listing with a `placement` that is not one of the defined placements
- **THEN** the request is rejected with 400 and no listing is returned

## ADDED Requirements

### Requirement: A product-linked banner serves the product's live price, never a stored copy
A banner MAY be linked to a `Product`. When it is, the publicly served banner's displayed price and compare-at price SHALL be read from that product's current `price` and `compareAtPrice` at request time, so they can never disagree with the product's own listing. A banner's own stored price fields SHALL be served only when no product is linked.

#### Scenario: Linked product's price changes
- **WHEN** a banner is linked to a product and that product's `price` is subsequently changed
- **THEN** the public banner listing reflects the product's new price without the banner itself being edited

#### Scenario: Banner stores a price but is linked to a product
- **WHEN** a banner has its own stored price and is also linked to a product
- **THEN** the publicly served price is the product's live price, and the banner's stored price is not served

#### Scenario: Banner with no linked product
- **WHEN** a banner has no linked product but has its own stored price and discount price
- **THEN** those stored values are served as the banner's price and discount price

#### Scenario: Banner links to a product that no longer exists
- **WHEN** a banner's linked product has been deleted
- **THEN** the banner is still served, with no product summary and no resolved product price, rather than causing the listing to fail

### Requirement: A publicly served banner carries a resolved click-through target
Every publicly served banner SHALL include a single resolved link that the storefront can navigate to without further lookups. When a product is linked, that link SHALL address the product by its slug; otherwise it SHALL be the banner's manually configured link. A banner with neither SHALL report no link rather than an invalid one.

#### Scenario: Banner linked to a product
- **WHEN** a banner with a linked product is publicly served
- **THEN** its resolved link addresses that product by the product's current slug
- **AND** a summary of the product sufficient to render the banner — including its name, slug, price, and primary image — is included

#### Scenario: Banner with only a manual link
- **WHEN** a banner has no linked product but has a manually configured link
- **THEN** its resolved link is that manual link

#### Scenario: Banner linked to a product and also carrying a manual link
- **WHEN** a banner has both a linked product and a manual link
- **THEN** the resolved link addresses the linked product, and the manual link is not used

#### Scenario: Banner with no target at all
- **WHEN** a banner has neither a linked product nor a manual link
- **THEN** it is still served, reporting no resolved link, and is not treated as an error

### Requirement: Banner content requirements depend on the banner's type
A banner SHALL declare a type of either `IMAGE` — a single clickable artwork with no overlaid content — or `DYNAMIC` — text, pricing, and styling rendered over a background. Creating or updating a banner SHALL enforce the fields its type requires and SHALL reject fields that do not apply to that type, so a stored banner is always renderable by its declared type. Every banner SHALL declare the placement it is served in.

#### Scenario: IMAGE banner without artwork
- **WHEN** an ADMIN creates a banner of type `IMAGE` with no image
- **THEN** the request is rejected with 400 and no banner is created

#### Scenario: DYNAMIC banner with no artwork
- **WHEN** an ADMIN creates a banner of type `DYNAMIC` with a title and a background color but no image
- **THEN** the banner is created, since a DYNAMIC banner renders its content over a background color and needs no artwork

#### Scenario: DYNAMIC banner without a title
- **WHEN** an ADMIN creates a banner of type `DYNAMIC` with no title
- **THEN** the request is rejected with 400 and no banner is created

#### Scenario: IMAGE banner given DYNAMIC-only content
- **WHEN** an ADMIN creates a banner of type `IMAGE` carrying overlay content such as a title, price, or button text
- **THEN** the request is rejected with 400, rather than silently storing content that will never be rendered

#### Scenario: Banner created without a placement
- **WHEN** an ADMIN creates a banner without specifying a placement
- **THEN** the request is rejected with 400 and no banner is created

#### Scenario: Banner styled with an invalid color
- **WHEN** an ADMIN creates a banner whose background or text color is not a valid hex color
- **THEN** the request is rejected with 400 and no banner is created

#### Scenario: Banner linked to a non-existent product
- **WHEN** an ADMIN creates or updates a banner referencing a product id that does not exist
- **THEN** the request is rejected with 404 identifying the product as not found, and no banner is created or modified

#### Scenario: Update that would leave a banner invalid for its type
- **WHEN** an ADMIN updates a `DYNAMIC` banner in a way that would clear its title
- **THEN** the request is rejected with 400 and the stored banner is unchanged

### Requirement: Banner artwork is uploaded as a file
An ADMIN SHALL be able to attach a banner's main and mobile artwork by uploading image files in the same request that creates or updates the banner, rather than having to host the images elsewhere and supply URLs. Uploaded artwork SHALL be stored and served as a URL, indistinguishable from artwork supplied as a URL. Supplying artwork as an already-hosted URL SHALL continue to work.

#### Scenario: Admin creates a banner by uploading artwork
- **WHEN** an ADMIN creates a banner with image files attached for its main and mobile artwork
- **THEN** each file is uploaded and the banner stores the resulting URLs
- **AND** the created banner is returned with those URLs

#### Scenario: Admin replaces only the artwork on an existing banner
- **WHEN** an ADMIN updates a banner with a new image file attached
- **THEN** the banner's stored artwork is replaced with the newly uploaded one
- **AND** the banner's other fields, including its type and title, are unchanged

#### Scenario: Update with no file attached
- **WHEN** an ADMIN updates a banner without attaching any image file
- **THEN** the banner's existing artwork is left untouched

#### Scenario: Artwork supplied as a URL still works
- **WHEN** an ADMIN creates a banner supplying its artwork as an already-hosted URL rather than a file
- **THEN** the banner is created with that URL, exactly as before file upload was supported

#### Scenario: An empty file is attached
- **WHEN** an ADMIN submits a banner with an artwork field carrying an empty file
- **THEN** the request is rejected with 400 identifying the empty field, and no banner is created or modified

#### Scenario: The type contract still applies to uploaded artwork
- **WHEN** an ADMIN creates a banner of type `IMAGE` with neither an uploaded file nor a URL for its artwork
- **THEN** the request is rejected with 400, the same as when artwork is missing from a URL-based request

### Requirement: Admins can browse banners by type and placement
The admin banner listing SHALL return banners of any status, and SHALL support filtering by status, type, and placement so an admin can review the set of banners competing for a single placement.

#### Scenario: Admin filters by placement
- **WHEN** an ADMIN requests the banner listing filtered to a single placement
- **THEN** only banners of that placement are returned, including ones that are not `ACTIVE` or are outside their scheduling window

#### Scenario: Non-admin cannot manage banners
- **WHEN** a request to create, update, or delete a banner is made without an OWNER/ADMIN session
- **THEN** the request is rejected with 401/403 and no data is changed
