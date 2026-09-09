## Purpose

Lets the merchant choose which courier service the shop dispatches through, declares what each courier supports so the panel never offers an action that cannot work, and keeps parcels already in flight bound to the courier that is actually carrying them.

## ADDED Requirements

### Requirement: The shop has one configured courier provider
Store settings SHALL carry the courier provider the shop dispatches through, chosen from a closed set of providers the system supports. The setting SHALL always resolve to a provider — there is no unset state — and SHALL default to Steadfast so an existing installation's behaviour is unchanged.

A merchant who does not use Steadfast should not have to edit server code, and a provider that can be absent forces every dispatch path to answer "what if nobody chose" — a state that has no useful behaviour.

#### Scenario: An existing shop keeps its current courier
- **WHEN** a shop that has never set a courier provider dispatches an order
- **THEN** the order is dispatched through Steadfast, exactly as before the setting existed

#### Scenario: Staff read the configured provider
- **WHEN** staff request store settings
- **THEN** the response names the configured courier provider

#### Scenario: An unsupported provider is refused
- **WHEN** staff attempt to set the courier provider to a value the system does not support
- **THEN** the request is rejected and the configured provider is unchanged

### Requirement: A provider declares which courier actions it supports
Each provider SHALL declare whether it supports dispatch, status lookup, balance enquiry, return requests and webhook delivery. An action a provider does not declare SHALL NOT be offered to staff, and SHALL be refused with a message naming the provider and the unsupported action if requested anyway.

Couriers differ in what their APIs expose. A panel that shows a balance button for a courier with no balance endpoint teaches staff that the panel is unreliable.

#### Scenario: An unsupported action is not offered
- **WHEN** the configured provider does not support balance enquiry
- **THEN** no balance figure or balance control is presented to staff

#### Scenario: An unsupported action is refused when requested directly
- **WHEN** a balance request is made while the configured provider does not support balance enquiry
- **THEN** the request is refused with a message naming the provider and the unsupported action, and no courier call is made

#### Scenario: Supported actions remain available
- **WHEN** the configured provider supports dispatch, status lookup, balance and returns
- **THEN** all four are offered to staff

### Requirement: Staff can see whether the configured provider is usable
The system SHALL report, for the configured provider, whether its credentials are present and whether its webhook is configured, without disclosing any credential value. A provider that is selected but not configured SHALL be reported as such before staff attempt a dispatch.

Discovering a missing credential at dispatch time, on a selection of packed parcels, is the most expensive moment to discover it.

#### Scenario: A selected but unconfigured provider is reported
- **WHEN** staff view courier settings while the configured provider's credentials are absent
- **THEN** the provider is shown as not configured, naming what is missing

#### Scenario: Credential values are never returned
- **WHEN** any settings or courier endpoint reports on provider configuration
- **THEN** the response states only whether each credential is present, never its value

### Requirement: A provider that creates no consignments is selectable
The system SHALL offer a manual provider representing a courier with no integration. It SHALL support no courier actions, and selecting it SHALL leave manual shipment entry fully functional.

A merchant using a local courier with no API needs a configured state that means "we handle this ourselves", not an unconfigured one that reads as a broken deployment.

#### Scenario: Manual selection disables courier dispatch
- **WHEN** the manual provider is configured and staff view an order
- **THEN** no courier dispatch action is offered and no configuration error is reported

#### Scenario: Manual shipment entry still works
- **WHEN** the manual provider is configured
- **THEN** staff can create and update a shipment by hand, with carrier and tracking number, exactly as for a shipment with no consignment

### Requirement: The provider cannot be changed while consignments are in flight
Changing the configured courier provider SHALL be refused while any consignment created by the current provider is not in a terminal state. The refusal SHALL name how many consignments are in flight.

Every in-flight consignment is polled against its provider's API using that provider's credentials. Switching underneath them means their status can never advance again, and the failure is silent — parcels simply stop updating.

#### Scenario: A switch with parcels in transit is refused
- **WHEN** staff change the courier provider while consignments created by the current provider are still in transit
- **THEN** the change is refused, naming the number of in-flight consignments, and the configured provider is unchanged

#### Scenario: A switch is allowed once everything has settled
- **WHEN** staff change the courier provider and every consignment created by the current provider is delivered, cancelled or otherwise terminal
- **THEN** the change is accepted

#### Scenario: A shop that has never dispatched can switch freely
- **WHEN** staff change the courier provider on a shop with no consignments at all
- **THEN** the change is accepted

### Requirement: Each provider receives webhooks at its own endpoint
Each provider that supports webhook delivery SHALL have its own webhook endpoint, identified by the provider. Each endpoint SHALL authenticate using that provider's own token and SHALL interpret the payload according to that provider's format. A webhook naming a provider the system does not support SHALL be rejected.

Couriers post different payload shapes and present different tokens. One endpoint guessing which courier sent a request would have to authenticate against every configured token to find out — which means a token leaked for one courier grants access to notifications for all of them.

#### Scenario: A provider's webhook is authenticated with that provider's token
- **WHEN** a webhook arrives at a provider's endpoint carrying that provider's configured token
- **THEN** it is accepted and processed under that provider's payload format

#### Scenario: One provider's token does not open another's endpoint
- **WHEN** a webhook arrives at one provider's endpoint carrying a different provider's token
- **THEN** the request is rejected

#### Scenario: An unknown provider endpoint is rejected
- **WHEN** a webhook arrives naming a provider the system does not support
- **THEN** the request is rejected without any lookup against stored consignments

#### Scenario: A previously registered webhook URL keeps working
- **WHEN** a webhook arrives at the endpoint path that existed before providers were introduced
- **THEN** it is processed as a Steadfast webhook, so a URL already registered in Steadfast's portal continues to work
