## Purpose

Decides which database serves a request, so one deployment can present several independent demonstration shops while a single-shop installation behaves exactly as it always has.

## ADDED Requirements

### Requirement: An installation with no demo map behaves as a single shop

When no demo map is configured, every request SHALL be served by the one database named in `DATABASE_URL`, and any demo key on the request SHALL be ignored. Such an installation SHALL require no environment variable, no build flag and no deployment step that was not already required before demo hosting existed.

This is the requirement the rest of the capability is built around: demo hosting is opt-in, and the single-shop path is the default rather than a special case of the multi-demo one.

#### Scenario: A client installation is configured exactly as before

- **WHEN** the server starts with `DATABASE_URL` set and no demo map configured
- **THEN** it serves every request from that database, and the set of environment variables it requires is the same set a single-shop installation required before this change

#### Scenario: A demo key is ignored where no demo map exists

- **WHEN** a request carrying a demo key arrives at an installation with no demo map configured
- **THEN** it is served from `DATABASE_URL` exactly as an unkeyed request would be, and the response is identical

#### Scenario: Background work outside a request is still served

- **WHEN** a scheduled job, a seed, or a verification script runs with no request in progress
- **THEN** it is served by `DATABASE_URL`, not left without a database

### Requirement: A demo key selects the database that serves the request

When a demo map is configured, a request carrying a key present in that map SHALL be served entirely — reads and writes, including anything inside a transaction — from the database that key names. A request carrying no key, or a key absent from the map, SHALL be served from `DATABASE_URL`.

Two requests carrying different keys SHALL NOT observe each other's data.

#### Scenario: Two demos hold separate catalogues

- **WHEN** a product is created through a request keyed `fashion`, and the catalogue is then listed through a request keyed `grocery`
- **THEN** the new product is absent from the `grocery` listing and present in the `fashion` listing

#### Scenario: An unknown key falls back rather than failing

- **WHEN** a request carries a demo key that the map does not contain
- **THEN** it is served from `DATABASE_URL` and the response is a normal one, not an error naming the key

#### Scenario: A transaction stays on one database

- **WHEN** a keyed request places an order, which writes across several tables in one transaction
- **THEN** every statement in that transaction runs against that demo's database, and the order is absent from every other demo

#### Scenario: Concurrent requests for different demos do not bleed

- **WHEN** requests keyed `fashion` and `grocery` are in flight at the same time
- **THEN** each reads and writes only its own database, whatever order their asynchronous work completes in

### Requirement: A demo's storefront and admin panel reach that demo's data

A storefront request SHALL be served with the data of the demo its hostname identifies. An admin panel opened on a demo's hostname SHALL read and write that same demo's data, without a separate build per demo.

#### Scenario: A storefront subdomain shows its own shop

- **WHEN** a shopper opens the storefront on the `fashion` demo's hostname
- **THEN** the products, categories, store name, theme and fonts shown are the `fashion` database's, not another demo's

#### Scenario: One admin build serves every demo

- **WHEN** an administrator opens the admin panel on the `grocery` demo's hostname and saves a product
- **THEN** the product is written to the `grocery` database, from the same admin build that serves the other demos

#### Scenario: An explicitly configured admin base URL still wins

- **WHEN** the admin panel is built with `VITE_API_BASE_URL` set, as a client installation's deploy guide instructs
- **THEN** it calls that URL, ignoring its own origin, exactly as it did before this change

### Requirement: Cached storefront content is never served across demos

Content the storefront caches SHALL be scoped to the demo it was fetched for, so that no cached page, list or fragment produced for one demo is served on another's hostname. Invalidating a demo's content SHALL NOT invalidate another demo's.

#### Scenario: One demo's catalogue is not served on another's subdomain

- **WHEN** the `fashion` storefront's product list has been cached, and the `grocery` storefront is then requested
- **THEN** `grocery` is served its own products, not the cached `fashion` ones

#### Scenario: Invalidating one demo leaves the others cached

- **WHEN** a product is saved in the `fashion` demo and its cache invalidation fires
- **THEN** the `fashion` storefront reflects the change, and no other demo's cached content is discarded

#### Scenario: A single-shop installation still invalidates its own content

- **WHEN** a merchant saves a product on an installation with no demo map
- **THEN** the storefront reflects the change, exactly as it did before this change

### Requirement: The demo key is not a security boundary

The demo key SHALL be treated as routing information supplied by the caller, not as an authorisation claim. A deployment that carries a demo map SHALL therefore hold demonstration data only.

Stating this is the point: it prevents the mechanism from later being relied on to separate one paying client's data from another's, which it cannot do.

#### Scenario: A caller may name any configured demo

- **WHEN** a request supplies the demo key of a shop other than the one whose hostname it arrived on
- **THEN** it is served that shop's data — the key is honoured, because it is routing and not permission

#### Scenario: Authentication is still enforced per demo

- **WHEN** a request carries a valid demo key but no valid session for an endpoint that requires one
- **THEN** it is rejected with 401/403 by that demo's own database, as it would be on a single-shop installation
