## MODIFIED Requirements

### Requirement: Store settings are singleton-safe through the API too
`GET`/`PATCH` on store settings SHALL always operate on the **resolved tenant's** one `StoreSetting` row — the API SHALL NOT expose any way for a tenant to hold two rows, and SHALL NOT accept a caller-supplied row identifier at all.

The row is addressed by the request's resolved tenant and by nothing else. A settings endpoint SHALL NOT take an id, a tenant parameter, or any other selector, because a selector is the only way a merchant could reach another merchant's configuration.

This replaces the former platform-wide singleton. Store configuration is per-shop by definition — a shop's name, currency, theme, navigation and checkout rules are the things that distinguish one merchant from another — so a single shared row is exactly what must not exist once more than one merchant is served.

#### Scenario: Admin updates the tax rate
- **WHEN** an OWNER/ADMIN updates a tax setting for their shop
- **THEN** their tenant's own configuration is updated and every subsequent settings read for that tenant reflects the new value
- **AND** no other tenant's configuration is affected

#### Scenario: Admin updates their shop's currency
- **WHEN** an OWNER/ADMIN updates their shop's currency settings
- **THEN** their tenant's single `StoreSetting` row is updated and every subsequent settings read for that tenant reflects the new value
- **AND** no other tenant's settings are affected

#### Scenario: Admin attempts to address a settings row directly
- **WHEN** a request supplies a row identifier or tenant selector to a settings endpoint
- **THEN** the value is ignored and the resolved tenant's own row is operated on

#### Scenario: Settings are read for a tenant that has never edited them
- **WHEN** a settings read is made for a tenant whose merchant has changed nothing
- **THEN** that tenant's own row is returned with usable defaults, not another tenant's values

### Requirement: Only OWNER can manage roles and permissions
Creating/editing `Role`, `Permission`, or `RolePermission` records SHALL be restricted to the `OWNER` role **within the resolved tenant** — not ADMIN or STAFF — since this controls the privilege system itself.

The OWNER role is held through the requester's membership in the resolved tenant. Holding OWNER in one tenant SHALL confer no privilege-management rights in any other tenant.

#### Scenario: ADMIN attempts to grant a new permission to a role
- **WHEN** a user with the ADMIN role in the resolved tenant attempts to modify `RolePermission`
- **THEN** the request is rejected (403); only that tenant's OWNER may perform this action

#### Scenario: OWNER of another shop attempts to manage privileges
- **WHEN** a user holding OWNER in tenant A issues a privilege-management request resolved to tenant B, where they hold no membership
- **THEN** the request is rejected; their role in tenant A is not considered
