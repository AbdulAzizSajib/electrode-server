## MODIFIED Requirements

### Requirement: Only OWNER/ADMIN/STAFF can access inventory endpoints
No inventory or procurement endpoint SHALL be reachable by a customer or an unauthenticated request. The role SHALL be read from the requester's membership **in the resolved tenant**, not from any role the user holds elsewhere on the platform.

Every inventory and procurement endpoint SHALL operate on the resolved tenant's warehouses, stock, movements, suppliers and purchase orders and on nothing else. Stock is the figure a merchant makes buying decisions from, and a reading drawn from another shop's rows is worse than an error.

#### Scenario: Customer attempts to view warehouse stock
- **WHEN** a customer-role request calls any inventory endpoint
- **THEN** the response is 403

#### Scenario: Staff of another shop calls an inventory endpoint
- **WHEN** a user holding OWNER/ADMIN/STAFF in tenant A issues an inventory request resolved to tenant B, where they hold no membership
- **THEN** the request is rejected; their role in tenant A is not considered

#### Scenario: Staff list stock
- **WHEN** a user holding an inventory-permitted role lists stock
- **THEN** only their tenant's warehouses and stock figures are returned, and no other tenant's rows contribute to any total, count or movement history

#### Scenario: A purchase order is addressed by id across tenants
- **WHEN** an inventory-permitted user requests, receives against, or amends a purchase order belonging to a different tenant
- **THEN** it is treated as not existing, and no stock or supplier balance changes
