## Purpose

The single admin surface for connecting third-party services — couriers, tracking pixels, and whatever
comes next — to the shop. It defines what an integration is, how a merchant enables one, and the rules
every integration card obeys regardless of which service it fronts, so that adding the next integration
is a card rather than a new page with its own conventions.

## ADDED Requirements

### Requirement: The integrations page replaces the courier settings page

The admin SHALL present one page titled "Integrations", described as managing courier and third-party
integrations, in place of the former "Courier Setting" page. The former route SHALL continue to resolve
so that existing bookmarks and in-app links do not break.

#### Scenario: Merchant opens the integrations page

- **WHEN** an OWNER or ADMIN opens `/ui/integrations`
- **THEN** the page title reads "Integrations" and lists every available integration as a separate card

#### Scenario: Sidebar entry is renamed

- **WHEN** an OWNER or ADMIN views the UI section of the sidebar
- **THEN** the entry reads "Integrations" and no entry reads "Courier Setting"

#### Scenario: Old route still resolves

- **WHEN** a request is made to `/ui/courier-settings`
- **THEN** the admin redirects to `/ui/integrations` without showing a not-found page

#### Scenario: Link from the courier report page

- **WHEN** a staff member follows the settings link on the courier report page
- **THEN** they arrive at the integrations page

#### Scenario: A STAFF user attempts access

- **WHEN** a user whose role is STAFF or CUSTOMER requests the integrations page
- **THEN** access is refused and no integration name, credential presence, or callback URL is disclosed

### Requirement: Each integration card saves independently

Every integration SHALL own its own enable toggle and its own save action. Saving one integration MUST
NOT read, write, or clear any field belonging to another integration.

#### Scenario: Saving one card leaves others untouched

- **WHEN** a merchant edits and saves the Facebook Pixel card while a courier card holds unsaved edits
- **THEN** only the Facebook Pixel values are persisted, and the courier card's saved values are unchanged

#### Scenario: A failed save keeps entered values

- **WHEN** a save is refused by the server
- **THEN** the card retains every value the merchant entered and displays the server's reason

#### Scenario: Unsaved changes are guarded

- **WHEN** a merchant navigates away from the page while any card holds unsaved edits
- **THEN** they are warned before the navigation completes

### Requirement: Disabling an integration stops it being used

An integration SHALL have an enabled state that is independent of whether its credentials are present.
A disabled integration MUST NOT be used by any server-side operation, and MUST NOT be offered as a
choice where the system asks the merchant to pick one.

#### Scenario: Disabled courier is not selectable

- **WHEN** a courier integration is disabled
- **THEN** it does not appear as a selectable courier for dispatch

#### Scenario: Disabled tracking integration fires nothing

- **WHEN** the Facebook Pixel integration is disabled
- **THEN** the storefront renders no pixel and the server sends no conversion events

#### Scenario: Disabling preserves stored credentials

- **WHEN** a merchant disables an integration and later re-enables it
- **THEN** the previously stored credentials are still present and no re-entry is required

#### Scenario: A disabled courier refuses to dispatch

- **WHEN** a dispatch is attempted through a courier that is switched off
- **THEN** it is refused before any order is sent, and the refusal says the courier is switched off rather than that it is unconfigured

#### Scenario: Re-enabling takes effect without a restart

- **WHEN** a merchant switches an integration back on
- **THEN** the next operation uses it, with no restart and no credential re-entry

### Requirement: An integration in use cannot be switched off

The system SHALL refuse to disable an integration that the shop currently depends on, and SHALL name what must change first. A shop MUST NOT be left in a state where its configured behaviour and its enabled integrations contradict each other.

#### Scenario: Disabling the selected courier

- **WHEN** a merchant tries to switch off the courier the shop dispatches through
- **THEN** the change is refused, the integration stays enabled, and the message says to select a different courier first

#### Scenario: Disabling an unselected courier

- **WHEN** a merchant switches off a courier the shop does not dispatch through
- **THEN** the change is accepted and its stored credentials are kept

#### Scenario: Parcels already dispatched keep being tracked

- **WHEN** an integration is switched off while consignments it created are still in transit
- **THEN** their delivery statuses continue to be read back, so no order is stranded part-way

### Requirement: The page reports each integration's readiness

Each card SHALL state whether the integration is ready to use, and when it is not, SHALL state what is
missing in terms the merchant can act on. Readiness MUST be determined by the server, not inferred by
the browser.

#### Scenario: Credentials absent

- **WHEN** an integration requiring credentials has none stored
- **THEN** the card states that credentials are not set and that the integration will not run until they are

#### Scenario: Credentials present but webhook unconfigured

- **WHEN** a courier integration has credentials but no webhook secret
- **THEN** the card states that dispatch works but status updates will only refresh on the scheduled sync

#### Scenario: Integration requiring no configuration

- **WHEN** an integration declares that it requires no credentials
- **THEN** the card reports it as ready rather than as unconfigured

#### Scenario: Readiness cannot be loaded

- **WHEN** the server's integration listing fails to load
- **THEN** the page states that it could not load, and renders no card that would imply an integration is absent or unconfigured
