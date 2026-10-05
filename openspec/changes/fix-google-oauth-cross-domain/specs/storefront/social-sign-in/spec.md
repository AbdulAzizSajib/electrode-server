## Purpose

How the storefront turns a completed Google handshake into a session in its own cookies, so the first page a customer sees after Google renders them as signed in, whether or not the storefront and the backend share a host.

## ADDED Requirements

### Requirement: Storefront session established after the handshake
The storefront SHALL expose a callback route that the Google handshake returns to, which SHALL establish the customer's session in the storefront's own cookies before any page renders for them.

The callback SHALL establish that session by redeeming the one-time exchange code the backend added to the return URL, in a request made from the storefront's server. It SHALL NOT depend on the browser presenting cookies the backend set, because a browser never sends a cookie set by the backend's host to a storefront on another host.

The callback SHALL be reachable by a visitor who has no storefront session, and SHALL NOT be treated as a guest-only screen that redirects an already-signed-in visitor away.

#### Scenario: Handshake succeeds on a split-host deployment
- **WHEN** the storefront and the backend run on different hosts and the callback is reached with a valid exchange code
- **THEN** the storefront writes its own session cookies for that customer
- **AND** the customer is redirected to the destination they started from
- **AND** the first rendered page shows them as signed in

#### Scenario: Handshake succeeds on a shared host
- **WHEN** the storefront and the backend share a host and the callback is reached with a valid exchange code
- **THEN** the customer is signed in exactly as in the split-host case

#### Scenario: Callback reached without a code
- **WHEN** the callback is reached with no exchange code
- **THEN** the customer is redirected to the sign-in screen carrying a failure reason
- **AND** no storefront session cookie is written

#### Scenario: Code is refused
- **WHEN** the backend refuses the exchange code as expired, replayed or unknown
- **THEN** the customer is redirected to the sign-in screen carrying a failure reason
- **AND** no storefront session cookie is written

#### Scenario: Backend unreachable during redemption
- **WHEN** the backend cannot be reached while the code is being redeemed
- **THEN** the customer is redirected to the sign-in screen carrying a failure reason
- **AND** no storefront session cookie is written

#### Scenario: Destination is off-site or malformed
- **WHEN** the callback is asked to return the customer to a destination that is not a path within this storefront
- **THEN** the customer is sent to the account area instead
- **AND** no off-site redirect is issued

#### Scenario: Callback URL is reused
- **WHEN** a callback URL that has already signed a customer in is opened again
- **THEN** the customer is redirected to the sign-in screen carrying a failure reason
- **AND** no storefront session cookie is written
