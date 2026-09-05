## Purpose

Covers merchant-authored blog posts — what a post holds, the single image-or-video media slot each one carries, how publication is controlled, and the three storefront surfaces a post appears on: the homepage section, the blog index, and the post's own page.

## ADDED Requirements

### Requirement: A merchant authors blog posts

The system SHALL let an authorised merchant create, edit and delete blog posts from the admin panel. A post SHALL hold a title, a URL slug, a short excerpt, a rich-text body, a publication date, and optional SEO title and description.

#### Scenario: Merchant publishes a post

- **WHEN** a merchant creates a post with a title, slug, excerpt and body and sets it to published
- **THEN** the post appears on the storefront's blog index
- **AND** it is reachable at its own address derived from the slug

#### Scenario: Merchant edits a published post

- **WHEN** a merchant changes a published post's title and saves
- **THEN** the storefront shows the new title without a redeploy

#### Scenario: Merchant deletes a post

- **WHEN** a merchant deletes a post
- **THEN** it no longer appears on any storefront surface
- **AND** its former address returns a not-found response

### Requirement: A post carries either an image or a video, never both

The system SHALL let a merchant attach exactly one piece of media to a post: an uploaded image, or an uploaded video with a poster frame. Choosing one SHALL replace the other rather than adding to it, so a post has one unambiguous thing to show.

#### Scenario: Merchant uploads an image

- **WHEN** a merchant uploads an image to a post and saves
- **THEN** that image is what the post shows on every storefront surface

#### Scenario: Merchant replaces an image with a video

- **GIVEN** a post that currently has an image
- **WHEN** the merchant uploads a video instead and saves
- **THEN** the post shows the video's poster frame in listings and the video on its own page
- **AND** the previously chosen image is no longer shown

#### Scenario: Merchant supplies no poster frame for a video

- **WHEN** a merchant uploads a video without choosing a poster frame
- **THEN** a frame is derived from the video and used as the post's still image
- **AND** no listing renders a blank or black rectangle in place of the media

#### Scenario: Merchant saves a post with no media

- **WHEN** a merchant saves a post without attaching an image or a video
- **THEN** the post is accepted
- **AND** its listings render without a media area rather than with an empty one

### Requirement: A video post does not autoplay in a listing

The system SHALL render a video post's poster frame, marked as playable, wherever posts appear as a list. The video itself SHALL play only on the post's own page.

#### Scenario: A video post in the homepage section

- **GIVEN** a published video post
- **WHEN** the homepage blog section renders
- **THEN** the card shows the poster frame with a visible indication that the post is a video
- **AND** no video loads or plays until the visitor opens the post

### Requirement: Only published posts are visible to shoppers

The system SHALL expose a post to the storefront only when its status is published. A draft SHALL be visible in the admin panel and nowhere else.

#### Scenario: A draft post

- **GIVEN** a post saved as a draft
- **WHEN** a shopper views the blog index, the homepage section, or requests the post's address directly
- **THEN** the post does not appear and its address returns a not-found response

#### Scenario: A post is unpublished

- **GIVEN** a published post
- **WHEN** the merchant changes it back to a draft
- **THEN** it disappears from the storefront

### Requirement: A slug is unique and cannot shadow a storefront route

The system SHALL require a post's slug to be lowercase, hyphen-separated, and unique among posts. A save that would duplicate an existing slug SHALL be rejected with a message identifying the conflict.

#### Scenario: A duplicate slug

- **WHEN** a merchant saves a post whose slug already belongs to another post
- **THEN** the save is rejected and names the conflicting post
- **AND** neither post is modified

#### Scenario: A malformed slug

- **WHEN** a merchant saves a post whose slug contains spaces, capitals or punctuation
- **THEN** the save is rejected with a message describing the accepted form

### Requirement: The homepage section shows the most recent posts

The system SHALL render the homepage's blog section from the most recently published posts, newest first, limited to what the section's layout holds.

#### Scenario: More posts exist than the section holds

- **GIVEN** twelve published posts
- **WHEN** the homepage renders
- **THEN** the section shows the newest four
- **AND** the remainder are reachable from the blog index

#### Scenario: A post's "read more" is followed

- **WHEN** a shopper follows the read-more link on a homepage blog card
- **THEN** they arrive at that post's own page, not at the index

### Requirement: Empty content leaves no empty section

The system SHALL omit the homepage's blog section entirely when no post is published, rather than rendering a heading over an empty grid.

#### Scenario: A shop with no posts

- **GIVEN** a shop with no published posts
- **WHEN** the homepage renders
- **THEN** no blog heading and no blog grid appear
- **AND** the surrounding sections are spaced as though the section were not part of the page

#### Scenario: The blog index with no posts

- **WHEN** a shopper opens the blog index on a shop with no published posts
- **THEN** the page states that there is nothing published yet rather than showing a bare heading

### Requirement: A post's page carries its own metadata

The system SHALL use a post's SEO title and description for its page's document metadata, falling back to the post's title and excerpt respectively when they are not supplied, so a post is never published without usable metadata.

#### Scenario: A post with no SEO fields

- **GIVEN** a published post with no SEO title or description
- **WHEN** its page is requested
- **THEN** the document title is the post's title and the description is its excerpt

### Requirement: A post's body is rendered safely

The system SHALL sanitise a post's rich-text body before rendering it in a browser, matching how other merchant-authored rich text on the storefront is handled.

#### Scenario: A body containing a script

- **GIVEN** a post whose stored body contains a script element
- **WHEN** the post's page renders
- **THEN** the script is not executed and is not present in the rendered document
