## ADDED Requirements

### Requirement: A cart mutation returns the authoritative post-mutation cart
Every cart mutation — adding an item, changing a line's quantity, removing a line — SHALL respond with the complete cart as it stands after the change, in the same shape a cart read returns, including any applicable discount. A client SHALL therefore need exactly one request to both apply a change and learn the cart's resulting state, with no follow-up read required to render a correct cart.

#### Scenario: Changing a line's quantity
- **WHEN** a shopper changes the quantity of one cart line
- **THEN** the response carries every line in the cart with its resulting quantities and totals, not only the line that changed
- **AND** the client can render the updated cart from that response alone

#### Scenario: Removing the last line holding a discount
- **WHEN** a shopper removes the cart line that was keeping an applied coupon valid
- **THEN** the mutation response already reflects the coupon no longer applying, without a further read

### Requirement: Cart quantity changes apply without blocking the shopper
Stepping a cart line's quantity SHALL take effect in the interface immediately, without waiting for the server to answer, and the controls SHALL remain operable while that change is in flight so a shopper can step a quantity several times in succession. Rapid successive steps on one line SHALL be settled against the server as the shopper's final intended quantity rather than one server round per click.

If the server rejects a change, the displayed quantity SHALL return to the last value the server confirmed, and the shopper SHALL be told the change did not apply.

#### Scenario: Shopper steps a quantity several times quickly
- **WHEN** a shopper clicks the increase control five times in rapid succession on one line
- **THEN** the displayed quantity tracks every click as it happens
- **AND** the server is asked for the final quantity rather than for each intermediate value

#### Scenario: Server rejects an optimistically applied quantity
- **WHEN** an optimistically displayed quantity change is rejected by the server, for example because stock ran out
- **THEN** the displayed quantity reverts to the last server-confirmed value and the shopper is shown why the change did not apply
