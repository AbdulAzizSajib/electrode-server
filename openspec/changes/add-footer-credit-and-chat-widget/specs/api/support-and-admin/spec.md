## ADDED Requirements

### Requirement: The chat widget's channel selects which destination is required
The `chatWidget` block on store settings SHALL be rejected when the destination its `channel` names is absent or blank. A `channel` of `whatsapp` requires a resolvable `whatsappNumber`; a `channel` of `messenger` requires a non-blank `messengerUsername`. This SHALL be enforced whenever the widget is `enabled`, because `chatWidget` is stored in an unconstrained Json column and API validation is the only gate on its contents.

A `whatsappNumber` SHALL be accepted only as digits, optionally preceded by a single `+`, with separators permitted on input and normalised away on storage — the destination is dialled as a URL path segment, so a stored value carrying spaces or dashes produces a link that silently fails to open a conversation.

#### Scenario: Enabling the WhatsApp channel with no number and no contact phone
- **WHEN** an OWNER/ADMIN saves `chatWidget` with `enabled: true`, `channel: "whatsapp"`, a blank `whatsappNumber`, and the store's `contactPhone` is also blank
- **THEN** the request is rejected (400) naming the missing destination, and the stored settings are unchanged

#### Scenario: Enabling the Messenger channel with no username
- **WHEN** an OWNER/ADMIN saves `chatWidget` with `enabled: true`, `channel: "messenger"`, and a blank `messengerUsername`
- **THEN** the request is rejected (400) naming the missing destination

#### Scenario: Saving a disabled widget with an incomplete destination
- **WHEN** an OWNER/ADMIN saves `chatWidget` with `enabled: false` and a blank destination for the selected channel
- **THEN** the request is accepted and the block is stored as given, so a merchant may configure the widget over more than one save without being blocked

#### Scenario: A phone number is submitted with separators
- **WHEN** an OWNER/ADMIN saves a `whatsappNumber` of `+880 1782-521705`
- **THEN** the request is accepted and the value is stored normalised to `+8801782521705`

### Requirement: The served chat widget carries an already-resolved destination
Every settings read that serves `chatWidget` — the admin read and the public read alike — SHALL serve a `whatsappNumber` that is already resolved: the stored value when it is non-blank, otherwise the store's `contactPhone`, otherwise absent. Consumers SHALL NOT be required to know about the fallback, so that the storefront and the admin preview cannot disagree about which number the widget dials.

A widget served as `enabled` SHALL always carry a usable destination for its channel. When the selected channel's destination resolves to nothing, the widget SHALL be served with `enabled: false` rather than as enabled-but-unreachable — an enabled flag alone must never be able to put a link that opens no conversation on every page of the storefront.

#### Scenario: Widget relies on the store's contact phone
- **WHEN** `chatWidget` is enabled on the `whatsapp` channel with a blank `whatsappNumber`, and `contactPhone` is `+8801782521705`
- **THEN** both the admin and public settings reads serve `chatWidget.whatsappNumber` as `+8801782521705`

#### Scenario: An explicit number overrides the contact phone
- **WHEN** `chatWidget.whatsappNumber` is set to a different number from `contactPhone`
- **THEN** both settings reads serve the explicit `whatsappNumber`, and `contactPhone` is unchanged by the widget's configuration

#### Scenario: A previously working widget loses its destination
- **WHEN** `chatWidget` is stored as enabled on the `whatsapp` channel with a blank `whatsappNumber`, and `contactPhone` is subsequently cleared
- **THEN** both settings reads serve `chatWidget` with `enabled: false`, and the stored block is left untouched so the configuration returns when a number is restored

### Requirement: The chat widget block holds no secret
`chatWidget` SHALL contain only values that are safe to publish. It is explicitly opted in to the public settings projection so the storefront can render the widget without a session, which makes every field on it readable by any visitor. No access token, API key, or other credential SHALL be added to it; such a value belongs in `IntegrationCredential`.

#### Scenario: Public settings read includes the widget
- **WHEN** an unauthenticated visitor reads `GET /settings/public`
- **THEN** the response includes the resolved `chatWidget` block, and that block contains no credential
