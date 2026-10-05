## Purpose

How the backend completes a Google sign-in in any deployment shape — including one where the storefront runs on a different host — and hands the resulting session to the storefront without putting a credential in a URL.

## ADDED Requirements

### Requirement: The handshake completes in production as it does locally
The backend SHALL recognise the session better-auth establishes at the end of a Google handshake under whatever cookie name better-auth uses in the current environment, including the `__Secure-` prefixed name it uses when secure cookies are enabled.

No step of the Google sign-in SHALL depend on a session cookie name that differs between a development and a production deployment.

#### Scenario: Production handshake succeeds
- **WHEN** a customer approves the Google consent screen against a backend running with secure cookies enabled
- **THEN** the backend recognises the session that the handshake established
- **AND** the customer is not redirected with `oauth_failed`

#### Scenario: Local handshake still succeeds
- **WHEN** a customer approves the Google consent screen against a backend running without secure cookies
- **THEN** the backend recognises the session that the handshake established

#### Scenario: Handshake produced no session
- **WHEN** the success step is reached without a session from the handshake
- **THEN** the customer is redirected to the storefront sign-in screen with a failure reason
- **AND** no exchange code is issued

### Requirement: A completed handshake is handed over by a one-time code
On a successful Google handshake the backend SHALL redirect the customer to the requested storefront path with a one-time exchange code added to it, and SHALL NOT place an access token, refresh token or session token in that redirect.

The code SHALL be unguessable, SHALL be valid for no more than 60 seconds, and SHALL be stored only in a form from which the code itself cannot be recovered.

#### Scenario: Customer is returned with a code
- **WHEN** a Google handshake succeeds
- **THEN** the customer is redirected to the storefront path they started from
- **AND** that URL carries an exchange code
- **AND** that URL carries no access, refresh or session token

#### Scenario: The requested path already has a query string
- **WHEN** the storefront path the customer started from already carries query parameters
- **THEN** those parameters are preserved and the code is added alongside them

#### Scenario: Off-site destination requested
- **WHEN** the requested return path is not a path on the storefront
- **THEN** the backend redirects to its default storefront path instead
- **AND** never to another host

### Requirement: An exchange code is redeemed exactly once for the session
The backend SHALL expose an endpoint that accepts an exchange code and returns the access token, refresh token and session token for the session the code was issued for, in the same shape the email sign-in and token-refresh endpoints return them.

A code SHALL be redeemable at most once. A code that has been redeemed, has expired, was never issued, or names a session that no longer exists SHALL be refused with 401 and SHALL return no token. Two concurrent redemptions of one code SHALL NOT both succeed.

#### Scenario: Valid code is redeemed
- **WHEN** an unexpired, unredeemed code is submitted
- **THEN** the response carries an access token, a refresh token and the session token
- **AND** the session token authenticates requests that require sign-in

#### Scenario: Code is replayed
- **WHEN** a code that has already been redeemed is submitted again
- **THEN** the request is refused with 401
- **AND** no token is returned

#### Scenario: Code has expired
- **WHEN** a code is submitted more than 60 seconds after it was issued
- **THEN** the request is refused with 401
- **AND** no token is returned

#### Scenario: Unknown code
- **WHEN** a code the backend never issued is submitted
- **THEN** the request is refused with 401

#### Scenario: Session was revoked before redemption
- **WHEN** a code is submitted whose session has since been signed out or has expired
- **THEN** the request is refused with 401

#### Scenario: Concurrent redemption
- **WHEN** the same code is submitted twice at the same moment
- **THEN** at most one of the two requests receives tokens

#### Scenario: Malformed request
- **WHEN** the request carries no code, or a code that is not a string
- **THEN** the request is refused with 400
