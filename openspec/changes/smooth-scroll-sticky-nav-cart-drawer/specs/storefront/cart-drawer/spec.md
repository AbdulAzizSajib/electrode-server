## Purpose

Defines how the cart drawer enters and leaves the screen, and how it behaves for
keyboard and assistive-technology users while it is open.

## ADDED Requirements

### Requirement: Drawer animates in and out

The cart drawer SHALL animate both when opening and when closing: the panel slides
between the right edge of the viewport and its resting position, while the backdrop
fades between transparent and its resting opacity.

#### Scenario: Opening the drawer

- **WHEN** the user opens the cart
- **THEN** the panel slides in from the right edge and the backdrop fades in
- **AND** the drawer's contents are readable once the motion settles

#### Scenario: Closing the drawer

- **WHEN** the user closes the cart
- **THEN** the panel slides out to the right edge and the backdrop fades out
- **AND** the drawer is not removed from the screen until that motion completes

#### Scenario: Reopening while closing

- **WHEN** the user reopens the cart while it is still animating closed
- **THEN** the panel returns to its open position without flickering or jumping
- **AND** the drawer ends in the open state

#### Scenario: Reduced motion preference is set

- **WHEN** the user's system reports `prefers-reduced-motion: reduce`
- **THEN** the drawer opens and closes without sliding or fading motion
- **AND** opening and closing the cart still works

### Requirement: Closed drawer is inert

While closed, the cart drawer MUST NOT be visible, MUST NOT intercept pointer input,
and MUST NOT be reachable by keyboard or exposed to assistive technology.

#### Scenario: Interacting with the page while the drawer is closed

- **WHEN** the drawer is closed and the user clicks or taps anywhere on the page
- **THEN** the click reaches the page content beneath, not the drawer

#### Scenario: Tabbing through the page while the drawer is closed

- **WHEN** the drawer is closed and the user moves through the page with the keyboard
- **THEN** focus never lands on a control inside the drawer

### Requirement: Drawer can be dismissed

An open cart drawer MUST offer more than one way to dismiss it.

#### Scenario: Dismissing with the close control

- **WHEN** the user activates the drawer's close control
- **THEN** the drawer closes

#### Scenario: Dismissing by clicking the backdrop

- **WHEN** the user clicks the backdrop outside the panel
- **THEN** the drawer closes

#### Scenario: Dismissing with the keyboard

- **WHEN** the drawer is open and the user presses `Escape`
- **THEN** the drawer closes

### Requirement: Open drawer manages focus and background scrolling

While the cart drawer is open it MUST take focus, keep focus within itself, restore
focus on close, and prevent the page behind it from scrolling.

#### Scenario: Focus on open

- **WHEN** the drawer opens
- **THEN** keyboard focus moves into the drawer

#### Scenario: Focus stays within the open drawer

- **WHEN** the drawer is open and the user moves forward through every focusable control
- **THEN** focus cycles within the drawer and does not reach page content behind it

#### Scenario: Focus on close

- **WHEN** the drawer closes
- **THEN** keyboard focus returns to the control that opened it

#### Scenario: Background does not scroll

- **WHEN** the drawer is open and the user scrolls with the pointer over the backdrop
- **THEN** the page behind the drawer does not scroll

#### Scenario: Scrolling the drawer's own contents

- **WHEN** the cart holds more items than fit in the panel and the user scrolls over the item list
- **THEN** the item list scrolls within the panel
- **AND** the page behind the drawer remains stationary
