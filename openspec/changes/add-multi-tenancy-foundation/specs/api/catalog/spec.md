## MODIFIED Requirements

### Requirement: Category and brand slugs are stable, unique lookup keys
Public single-item lookups SHALL be addressable by `slug`, not just internal `id`. A slug SHALL be unique **within a tenant** and SHALL resolve only within the tenant the request is resolved to.

The same slug SHALL be usable by any number of tenants simultaneously. Two shops selling the same product are the normal case, not a conflict, and a merchant SHALL NOT be prevented from choosing a slug — nor learn anything about another shop's catalog — because another tenant already uses it.

#### Scenario: Product lookup by slug
- **WHEN** a shopper requests `GET /products/{slug}`
- **THEN** the matching `ACTIVE` product **belonging to the resolved tenant** is returned by its slug, independent of its `id`

#### Scenario: Two shops use the same product slug
- **WHEN** two tenants each hold a product with the slug `iphone-15` and a shopper requests that slug at one of them
- **THEN** only that shop's product is returned, and the other shop's product is not reachable from this request

#### Scenario: A slug exists only in another shop
- **WHEN** a shopper requests a slug that exists in a different tenant but not in the resolved one
- **THEN** the response is 404, identically to a slug that exists nowhere

#### Scenario: A merchant creates a product using a slug another shop holds
- **WHEN** a merchant creates a product whose slug is already used by a different tenant
- **THEN** the create succeeds
