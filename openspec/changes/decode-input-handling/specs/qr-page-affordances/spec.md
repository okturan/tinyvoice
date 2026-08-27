## ADDED Requirements

### Requirement: Share actions report failure
Every action that copies data to the clipboard SHALL report both success and failure to the user, and SHALL NOT surface a failure as an uncaught error.

#### Scenario: Copying a link when the clipboard refuses
- **WHEN** copying the share link fails
- **THEN** the control reports the failure
- **AND** no uncaught error reaches the page

#### Scenario: Copying succeeds
- **WHEN** copying succeeds
- **THEN** the control confirms it, then returns to its normal label

### Requirement: Page controls have accessible names
Every interactive control SHALL expose an accessible name describing what it does, including controls whose visible content is only an icon.

#### Scenario: The settings control
- **WHEN** assistive technology enumerates the page's controls
- **THEN** the control that opens settings is identifiable by name

### Requirement: Navigating to the current page preserves its content
Activating the navigation entry for the page the user is already on SHALL NOT discard a loaded packet.

#### Scenario: The current page's navigation entry
- **WHEN** a packet is loaded from a voice link and the user activates the navigation entry for that same page
- **THEN** the packet is still loaded
