## Purpose

Holds the delivery companies a merchant hands parcels to as records rather than as text retyped on every shipment, so that a courier can be named consistently, kept current, and reported on across the orders it carried.

## ADDED Requirements

### Requirement: Courier record

A courier SHALL be identifiable by a name that is unique among couriers, so that the same delivery company cannot exist twice under identical spelling.

A courier record SHALL additionally be able to carry a contact phone, a contact email, a coverage note describing the areas it serves, and a tracking-URL template used to turn a tracking number into a link. All of these SHALL be optional: a merchant who knows only the courier's name SHALL be able to save one.

Where a tracking-URL template is present, it SHALL indicate where the tracking number belongs, and the system SHALL produce a usable link for a shipment carrying both that courier and a tracking number.

#### Scenario: Courier saved with a name alone

- **WHEN** staff create a courier supplying only a name
- **THEN** the courier is saved and available for assignment

#### Scenario: Duplicate courier name is refused

- **WHEN** staff create a courier with a name that already exists
- **THEN** the request is refused and no second courier is created

#### Scenario: Tracking link is produced from the template

- **WHEN** a shipment carries a courier with a tracking-URL template and a tracking number
- **THEN** a link to that courier's tracking page for that number is available

#### Scenario: Missing template yields no link

- **WHEN** a shipment carries a courier with no tracking-URL template
- **THEN** the tracking number is shown as text and no link is offered

### Requirement: Active and inactive couriers

A courier SHALL carry an active flag. Deactivating a courier SHALL remove it from the choices offered when assigning new shipments, while leaving every shipment already assigned to it untouched and still displaying that courier's name.

Deactivation SHALL be reversible, and reactivating a courier SHALL return it to the assignment choices.

#### Scenario: Inactive courier is not offered for new work

- **WHEN** staff open the courier choices while assigning a shipment
- **THEN** couriers marked inactive do not appear among them

#### Scenario: Existing shipments survive deactivation

- **WHEN** a courier carrying shipments is deactivated
- **THEN** those shipments still name that courier and are otherwise unchanged

#### Scenario: Reactivation restores availability

- **WHEN** an inactive courier is marked active again
- **THEN** it appears among the courier choices for new shipments

### Requirement: Deleting a courier in use

The system SHALL NOT silently discard the courier recorded against a shipment. When staff attempt to delete a courier that shipments reference, the request SHALL be refused with an indication that the courier is in use and how many shipments reference it.

Staff SHALL then be able to either reassign those shipments to another courier and delete, or deactivate the courier instead of deleting it. A courier that no shipment references SHALL be deletable outright.

#### Scenario: Deleting a referenced courier is refused

- **WHEN** staff attempt to delete a courier that three shipments reference
- **THEN** the deletion is refused and the response reports that it is in use

#### Scenario: Unreferenced courier deletes

- **WHEN** staff delete a courier that no shipment references
- **THEN** the courier is removed

#### Scenario: Reassignment clears the way

- **WHEN** the shipments referencing a courier are reassigned to another and the original is deleted again
- **THEN** the deletion succeeds

### Requirement: Courier management is staff-only

Creating, editing, deactivating and deleting couriers SHALL be restricted to staff roles with administrative rights. A customer SHALL NOT be able to read or alter the courier list.

Every change to a courier record SHALL be recorded in the audit log against the user who made it.

#### Scenario: Customer cannot read the courier list

- **WHEN** a customer-role session requests the courier list
- **THEN** access is refused

#### Scenario: Courier edits are audited

- **WHEN** staff change a courier's contact details
- **THEN** an audit entry records the change and its author
