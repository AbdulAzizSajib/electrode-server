## Purpose

Defines how the platform partitions every piece of data between the merchants that subscribe to it: how a request is attributed to exactly one shop, what guarantees that one shop can never read or write another's rows, and which facts are deliberately shared across the whole platform rather than owned by a shop.

## ADDED Requirements

### Requirement: Every request resolves to exactly one tenant

Every request that reaches a data-access path SHALL carry exactly one resolved tenant, established before any handler runs. Resolution SHALL come from the request's own context and never from a value the caller supplies in a query string, body field or header.

Two resolution sources exist, and which applies is determined by the request, not by configuration:

- A **storefront** request resolves its tenant from the request hostname's subdomain, because one hostname serves exactly one shop.
- An **admin or authenticated merchant** request resolves its tenant from the requesting user's membership, because one admin application serves every merchant.

A request that resolves no tenant SHALL be rejected. There SHALL be no default, fallback or "first" tenant for an unresolved request, because any such fallback turns a misconfiguration into a silent cross-tenant write.

#### Scenario: Storefront request arrives on a known subdomain
- **WHEN** a request arrives for a hostname whose subdomain matches an existing tenant
- **THEN** that tenant is bound to the request for its whole lifetime, and every read and write the request performs is attributed to it

#### Scenario: Request arrives on an unknown hostname
- **WHEN** a request arrives for a hostname that matches no tenant
- **THEN** the request is rejected and no data-access path runs
- **AND** no tenant is assumed

#### Scenario: Caller supplies a tenant identifier
- **WHEN** a request includes a tenant identifier in its query string, body or headers
- **THEN** that value is ignored entirely and the tenant is resolved from the request context as normal

#### Scenario: Authenticated user belongs to no tenant
- **WHEN** an authenticated user with no membership calls an admin endpoint
- **THEN** the request is rejected rather than served against any tenant

### Requirement: Isolation is guaranteed by the data-access layer, not by callers

Tenant scoping SHALL be applied by the shared data-access layer for every model and every operation, so that a read issued without an explicit tenant condition is still restricted to the resolved tenant, and a write issued without an explicit tenant value is still attributed to it.

Correct behavior SHALL NOT depend on an individual service remembering to filter. A service that omits a tenant condition SHALL still be isolated.

This is a normative property of the system, not an implementation preference: a scoping scheme that each of the platform's many modules must opt into cannot be verified by inspection, and an omission in one of them is invisible from the outside until it leaks.

#### Scenario: A read issued with no tenant condition
- **WHEN** a handler lists records without naming the tenant in its own conditions
- **THEN** only records belonging to the resolved tenant are returned

#### Scenario: A write issued with no tenant value
- **WHEN** a handler creates a record without naming the tenant in the data it supplies
- **THEN** the record is stored against the resolved tenant

#### Scenario: A record is addressed by id from another tenant
- **WHEN** a request fetches, updates or deletes a record by an id that belongs to a different tenant
- **THEN** the record is treated as not existing — the read returns nothing, and the update or delete affects no rows

#### Scenario: A list endpoint receives a tenant filter as a query parameter
- **WHEN** a client passes a tenant field among a list endpoint's filter parameters
- **THEN** the resolved tenant's scope still applies unchanged and the supplied value does not widen or redirect it

### Requirement: Unscoped access is explicit, narrow and audited

The system SHALL provide exactly one mechanism for reading across tenants, and that mechanism SHALL be explicit at the call site rather than implied by context, configuration or role.

Every use SHALL write an audit entry recording who performed it, when, and what was accessed. No endpoint reachable by a merchant or a shopper SHALL use it.

One mechanism, not several, because the question "where can this system read across tenants?" must have an answer that is enumerable rather than argued.

#### Scenario: Platform-level code reads across tenants
- **WHEN** a platform-level operation reads data belonging to more than one tenant through the unscoped mechanism
- **THEN** the read succeeds
- **AND** an audit entry is written identifying the actor, the time and the scope of the access

#### Scenario: A merchant-reachable endpoint attempts unscoped access
- **WHEN** any endpoint reachable with merchant or shopper credentials is exercised
- **THEN** it performs no unscoped access, and its results contain only the resolved tenant's data

### Requirement: Uniqueness is tenant-relative unless it identifies a person

Every uniqueness constraint on shop-owned data — slugs, SKUs, codes, human-readable sequence numbers, names, and opaque client-held tokens — SHALL be unique within a tenant and SHALL NOT be unique across the platform.

The exception is the identity of a **person**: a login email address and a login contact number SHALL remain unique platform-wide, because one human holds one account and may hold roles in several shops through it.

A merchant SHALL NOT be able to observe another merchant's data through a uniqueness conflict. A rejected create caused by a value another shop already holds is itself a disclosure, and is therefore not a behavior this system has.

#### Scenario: Two shops use the same product slug
- **WHEN** two tenants each create a product with the slug `iphone-15`
- **THEN** both succeed, and each shop's public lookup for that slug returns only its own product

#### Scenario: Two shops issue the same coupon code
- **WHEN** two tenants each create a coupon with the code `EID25`
- **THEN** both succeed, and a shopper redeeming it at one shop redeems only that shop's coupon

#### Scenario: Two shops number their orders independently
- **WHEN** each of two tenants places its first order
- **THEN** each receives the first number in its own sequence, and neither sequence reveals the other shop's order volume

#### Scenario: One person registers an account once
- **WHEN** a person already holding an account registers again with the same email address at a different shop
- **THEN** the registration is refused as an existing account rather than creating a second account for the same person

### Requirement: A role is held within a tenant, not globally

A user's role SHALL be a property of their membership in a specific tenant, not a property of the user. A user SHALL be able to hold different roles in different tenants, and holding a role in one tenant SHALL confer nothing in any other.

Authorization checks SHALL evaluate the role the requester holds **in the resolved tenant**. A request from a user with no membership in the resolved tenant SHALL be treated as unauthorized regardless of any role they hold elsewhere.

#### Scenario: A shop owner shops at another shop
- **WHEN** a user who owns shop A places an order at shop B
- **THEN** they act at shop B with only the role their shop B membership grants, and receive no administrative access there

#### Scenario: An administrator of one shop calls another shop's admin endpoint
- **WHEN** a user holding an administrative role in shop A calls an administrative endpoint resolved to shop B, where they hold no membership
- **THEN** the request is rejected

### Requirement: A person is a distinct customer in each shop they buy from

A shopper's per-shop record — their order history, addresses, cart, wishlist and reviews — SHALL belong to one tenant. The same person transacting at two shops SHALL have two independent customer records with no data shared between them.

Guest checkout identifies a returning buyer by their phone number, and that match SHALL be performed **within the resolved tenant only**. Matching a phone number across tenants would merge two merchants' customers into one record and resolve orders to the wrong shop.

#### Scenario: The same phone number buys from two shops as a guest
- **WHEN** a guest places an order at shop A and later places an order at shop B using the same phone number
- **THEN** two separate customer records exist, one per shop
- **AND** neither shop's merchant can see the other shop's order for that number

#### Scenario: A returning guest buys twice from the same shop
- **WHEN** a guest places a second order at the same shop with the phone number they used before
- **THEN** the order attaches to their existing customer record at that shop, exactly as it did before tenancy existed

### Requirement: Creating a tenant yields a usable shop

Creating a tenant SHALL create the configuration and reference data that shop needs to serve requests, so that a newly created tenant is immediately operable rather than depending on a later manual step.

A tenant SHALL carry a lifecycle status, and the status SHALL be recorded from creation onward so that later work can gate on it. This capability defines only that the status exists and is stored; what any particular status permits or denies is out of scope here.

#### Scenario: A tenant is created
- **WHEN** a new tenant is created
- **THEN** its configuration record exists, its roles are available for membership, and requests resolved to it are served without any additional setup step

#### Scenario: A tenant's settings are read before any merchant edit
- **WHEN** the settings of a newly created tenant are read
- **THEN** usable defaults are returned rather than an empty or missing record

### Requirement: Cache invalidation is scoped to one tenant

An event that invalidates cached storefront content SHALL invalidate it for the originating tenant only. A merchant's save SHALL NOT invalidate, refresh or otherwise affect any other merchant's cached content.

Invalidation remains best-effort and SHALL NOT fail the merchant's write, preserving the existing guarantee. The scoping requirement is about blast radius, not reliability.

#### Scenario: A merchant saves a setting
- **WHEN** a merchant saves a change that invalidates cached content
- **THEN** only that tenant's cached content for the affected area is invalidated
- **AND** every other tenant's cached content is untouched

#### Scenario: Invalidation cannot be delivered
- **WHEN** the invalidation cannot be delivered for any reason
- **THEN** the merchant's write still succeeds, and the affected content refreshes on its own expiry as before

### Requirement: Existing data becomes the first tenant with no behavior change

The shop operating before this capability existed SHALL become a tenant, and all of its existing records SHALL belong to it. No existing record SHALL be left unattributed.

Its externally observable behavior SHALL be unchanged by the migration: the same products resolve by the same slugs, the same orders carry the same numbers, and the same customers are reachable by the same phone numbers.

#### Scenario: The live shop is migrated
- **WHEN** the migration completes
- **THEN** every pre-existing record belongs to the first tenant, and requests to the live shop return exactly what they returned before

#### Scenario: A record is left without a tenant
- **WHEN** the migration would leave any record unattributed
- **THEN** the migration fails rather than completing with partially attributed data
