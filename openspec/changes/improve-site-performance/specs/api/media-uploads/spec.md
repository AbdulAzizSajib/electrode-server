## Purpose

Bounds what a merchant can upload and normalises uploaded images before they are stored, so that no stored original is larger than any page will ever display.

## ADDED Requirements

### Requirement: Uploaded files are bounded by size and type
Every upload endpoint SHALL accept only the file types it is meant for and SHALL refuse a file above its size limit before sending anything to the image host. Image fields SHALL accept image types up to 10 MB. Video fields SHALL accept video types up to 100 MB. The general file upload SHALL accept images and PDF up to 10 MB. The database backup restore upload is excluded from these limits.

#### Scenario: Oversized image is refused
- **WHEN** an admin uploads a 14 MB JPEG to a product, category, brand, banner, avatar or general upload field
- **THEN** the response is 413 with `success: false` and an `errorSources[0].message` that names the 10 MB limit
- **AND** nothing is uploaded to the image host and no record is changed

#### Scenario: Wrong file type is refused
- **WHEN** an admin uploads an `.exe` or a video to an image-only field
- **THEN** the response is 415 with `success: false` and a message naming the accepted types

#### Scenario: Product video within the limit is accepted
- **WHEN** an admin uploads a 60 MB MP4 to the product video upload
- **THEN** the upload succeeds and returns the video URL and its poster URL as before

#### Scenario: Backup restore is unaffected
- **WHEN** an OWNER uploads a database backup file larger than 100 MB
- **THEN** the restore upload is accepted under its existing rules

### Requirement: Uploaded images are normalised before storage
An uploaded photographic image (JPEG, PNG, WebP, AVIF, HEIC/HEIF, TIFF, BMP) SHALL be stored no larger than 2000 px on its longest side and re-encoded with automatic quality. An image already within 2000 px SHALL NOT be upscaled. Its aspect ratio SHALL be preserved. Vector (SVG), icon (ICO) and GIF images, videos and PDFs SHALL be stored unchanged.

#### Scenario: Large phone photo is downsized on upload
- **WHEN** an admin uploads a 6000×4000 JPEG
- **THEN** the stored image at the returned URL is 2000×1333

#### Scenario: Small image is not enlarged
- **WHEN** an admin uploads an 800×800 PNG
- **THEN** the stored image at the returned URL is 800×800

#### Scenario: Previously uploaded images keep working
- **WHEN** a product references an image uploaded before this change
- **THEN** its URL still resolves; existing images are not reprocessed or moved
