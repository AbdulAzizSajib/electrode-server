## Purpose

Defines how the storefront's page scrolling behaves — eased, momentum-carrying motion
in place of raw native stepping — and the conditions under which that easing must yield
to the platform's own scrolling.

## ADDED Requirements

### Requirement: Eased page scrolling

The storefront SHALL apply eased, momentum-carrying motion to page scrolling, so that
a scroll input decelerates to rest rather than stopping on the frame the input ends.

#### Scenario: Wheel scroll eases to rest

- **WHEN** a user scrolls the page with a mouse wheel or trackpad and stops the input
- **THEN** the page continues moving briefly and decelerates smoothly to a stop
- **AND** the final resting position reflects the total scroll distance requested

#### Scenario: Touch scroll retains native feel

- **WHEN** a user scrolls by dragging on a touch device
- **THEN** the page follows the finger during the drag without added latency
- **AND** releasing the drag carries the page onward with momentum

#### Scenario: Scrolling reaches document ends

- **WHEN** a user scrolls continuously toward the top or bottom of the document
- **THEN** the page settles exactly at the document boundary
- **AND** no content is left unreachable beyond that boundary

### Requirement: Reduced-motion opt-out

The storefront MUST disable eased scrolling and fall back to the platform's native
scrolling whenever the user has expressed a preference for reduced motion.

#### Scenario: Reduced motion preference is set

- **WHEN** the user's system reports `prefers-reduced-motion: reduce`
- **THEN** page scrolling behaves natively with no added easing or momentum
- **AND** all page content remains reachable by scrolling

#### Scenario: Preference changes during a session

- **WHEN** the user changes their reduced-motion preference while a page is open
- **THEN** scrolling behaviour follows the new preference without requiring a reload

### Requirement: Programmatic scrolls remain correct

Scrolls the storefront initiates itself — anchor links, "back to top" affordances, and
navigation between routes — MUST land on the correct position while eased scrolling is
active.

#### Scenario: In-page anchor link

- **WHEN** a user activates a link targeting an element on the same page
- **THEN** the page scrolls to that element
- **AND** the element comes to rest fully visible, not concealed beneath any pinned header row

#### Scenario: Navigating to a new route

- **WHEN** a user navigates to a different route
- **THEN** the new page is displayed from its top
- **AND** no scroll offset carries over from the previous route

### Requirement: Nested scroll areas scroll independently

Regions that scroll within themselves — such as overlay panels and dropdown lists —
MUST scroll their own content when the pointer is over them, without the page scrolling
in their place.

#### Scenario: Scrolling inside an overlay panel

- **WHEN** a user scrolls with the pointer over a scrollable region inside an open overlay
- **THEN** that region's content scrolls
- **AND** the page behind the overlay does not scroll

#### Scenario: Nested region reaches its end

- **WHEN** a scrollable region inside an overlay is scrolled to its end and the user keeps scrolling
- **THEN** the page behind the overlay remains stationary while the overlay is open
