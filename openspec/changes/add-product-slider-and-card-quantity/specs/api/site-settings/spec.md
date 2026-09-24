## ADDED Requirements

### Requirement: Catalog display settings govern whether the cart opens after an add

The catalog display settings SHALL carry a flag governing whether the storefront's cart drawer opens by itself when a shopper adds a product. Its default SHALL be to open it, reproducing the storefront's behaviour before the flag existed.

The flag SHALL be written, validated and published on the same terms as the catalog display flags already offered:

- it SHALL be gated on write by the same validation that gates the rest of that block, since the column it lives in cannot constrain its own shape;
- a write of that block SHALL carry every flag it offers, so that a reader can never confuse "the merchant turned this off" with "this key predates the flag";
- it SHALL be published on the public settings payload the storefront already fetches, and SHALL be subject to the same invalidation, so a saved change reaches the storefront without a redeploy;
- a stored block missing the flag SHALL be reported with the flag at its default rather than absent.

Adding the flag SHALL NOT require existing stored settings to be rewritten.

#### Scenario: A shop that predates the flag

- **WHEN** the stored catalog display settings carry no value for this flag
- **THEN** the published settings report it at its default of opening the cart
- **AND** the stored settings are not modified

#### Scenario: The merchant turns it off

- **WHEN** a merchant saves the catalog display settings with the flag off
- **THEN** the published settings report it off
- **AND** the other catalog display flags are unchanged

#### Scenario: A partial write is refused

- **WHEN** a write of the catalog display settings omits one of the flags that block offers
- **THEN** the write is refused
- **AND** the stored settings are left as they were

#### Scenario: A saved change reaches the storefront

- **WHEN** a merchant saves a change to this flag
- **THEN** a subsequent visit to the storefront behaves according to the new value without a redeploy
