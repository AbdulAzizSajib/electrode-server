## Purpose

Lets a merchant manage the homepage hero as the layout it actually is — one wide slider, two square side tiles and one wide promo tile — rather than as a flat list of banner rows, so the effect of every edit is obvious before it goes live.

## ADDED Requirements

### Requirement: The hero manager mirrors the storefront hero layout
The admin hero manager SHALL present the three hero slot types in the same spatial arrangement and aspect ratios the storefront renders: a wide slider occupying the left column, two square-ish side tiles stacked as a row in the top of the right column, and one wide promo tile beneath them. Each slot SHALL show its current artwork, or an empty placeholder shaped to that slot's ratio when nothing is assigned.

#### Scenario: Empty hero
- **WHEN** an admin opens the hero manager with no hero banners configured
- **THEN** four correctly-proportioned empty slots are shown — one slider, two side tiles, one promo — each with an action to add artwork

#### Scenario: Layout matches the storefront
- **WHEN** an admin has configured all four slots
- **THEN** the manager's preview arrangement and each slot's aspect ratio match what the storefront homepage renders

### Requirement: Each slot states its required artwork dimensions
Every slot in the hero manager SHALL display the recommended upload size in explicit pixels, in `<width>px × <height>px` form, together with the aspect ratio. The stated sizes SHALL be:

| Slot | Recommended upload | Ratio |
| --- | --- | --- |
| Hero slider | **1720 px × 1290 px** | 1.33 : 1 |
| Hero side tile | **644 px × 644 px** | 1.00 : 1 |
| Hero promo tile | **1320 px × 614 px** | 2.15 : 1 |
| Mobile artwork (any slot) | **800 px × 800 px** | 1 : 1 |

These sizes SHALL NOT depend on the store's configured content width. The storefront proportions each slot to that width, so a slot's ratio is fixed and only its rendered size changes — see the theming capability's "Merchandising artwork keeps its shape at every content width". Each recommended size is twice what the widest offered content width renders, so artwork stays sharp on a high-DPI display and never has to be re-uploaded after a width change.

#### Scenario: Guidance is visible before upload
- **WHEN** an admin opens the upload control for the hero slider slot
- **THEN** the text `1720 px × 1290 px` and its aspect ratio are shown next to the control

#### Scenario: Rendered size reflects the store's own width
- **WHEN** an admin views a slot's guidance
- **THEN** the size that slot renders at for this store's configured content width is shown alongside the recommended upload size, and a full-width store is given the figure for a common large desktop viewport

#### Scenario: Recommended size survives a width change
- **WHEN** a merchant changes the store's content width and an admin reopens the hero manager
- **THEN** the recommended upload size and ratio for every slot are unchanged, and only the rendered figure differs

#### Scenario: Wrong-ratio upload is flagged
- **WHEN** an admin uploads artwork whose aspect ratio differs from the slot's by more than a small tolerance
- **THEN** a non-blocking warning names the expected dimensions and states that the image will be cropped to fill the slot, and the admin can still proceed

#### Scenario: Undersized upload is flagged
- **WHEN** an admin uploads artwork narrower than the widest size the slot is ever rendered at
- **THEN** a non-blocking warning states the image will appear blurry and names the recommended size

### Requirement: Hero slots enforce their capacity
The storefront renders at most two side tiles and exactly one promo tile; the hero manager SHALL enforce those limits rather than letting a merchant create banners that silently never appear. The slider slot SHALL accept multiple ordered slides.

#### Scenario: Third side tile refused
- **WHEN** an admin tries to add a third side tile
- **THEN** the action is unavailable and the manager explains that the layout has exactly two side positions

#### Scenario: Second promo tile refused
- **WHEN** an admin tries to add a second promo tile
- **THEN** the action is unavailable, and replacing the existing promo tile is offered instead

#### Scenario: Slider accepts multiple slides
- **WHEN** an admin adds several slides to the slider slot
- **THEN** all of them are saved and the storefront cycles through them in the admin's chosen order

### Requirement: Slot ordering is set by direct manipulation
Within the slider slot and across the two side tiles, an admin SHALL be able to change display order by reordering the previews directly. The resulting order SHALL be what the storefront renders.

#### Scenario: Reordering slides
- **WHEN** an admin drags the third slide to the first position and saves
- **THEN** the storefront shows that slide first on the next load after the cache window elapses

#### Scenario: Swapping side tiles
- **WHEN** an admin swaps the two side tiles
- **THEN** the storefront renders them in the swapped left-to-right order

### Requirement: A hero slot carries the same banner controls as any other banner
Each hero slot SHALL expose the banner attributes a merchant needs: desktop artwork, optional mobile artwork, link target (a manual URL or a linked product), status, and an optional schedule window. Saving a slot SHALL not require leaving the hero manager for a separate form.

#### Scenario: Editing in place
- **WHEN** an admin changes a slot's link target and status and saves
- **THEN** the change is persisted without navigating to a different page, and the manager reflects the new values

#### Scenario: Scheduled slot shows its window
- **WHEN** a slot has a future start date
- **THEN** the manager marks it as scheduled and shows when it goes live, and the storefront does not render it yet

#### Scenario: Inactive slot is dimmed
- **WHEN** a slot's status is not active
- **THEN** the manager renders its preview visibly dimmed or badged so an admin can tell at a glance that the storefront is not showing it

### Requirement: Non-hero banners remain manageable
Banners in the header, mid-page, footer, sidebar and popup placements SHALL continue to be listable, creatable, editable and deletable from the admin panel after the hero manager is introduced. Their management surface SHALL live under the same UI section as the hero manager.

#### Scenario: Non-hero banner still editable
- **WHEN** an admin edits an existing mid-page banner
- **THEN** the edit succeeds exactly as before this change

#### Scenario: Hero placements are not duplicated in the banner list
- **WHEN** an admin opens the banner list
- **THEN** hero-placement banners are not listed there, and a link points to the hero manager instead

#### Scenario: Old banner URL still resolves
- **WHEN** someone follows a bookmarked link to the previous banner list location under Marketing
- **THEN** they are redirected to the banner list's new location rather than seeing a not-found page
