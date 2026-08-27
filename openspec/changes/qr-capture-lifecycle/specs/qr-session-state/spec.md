## ADDED Requirements

### Requirement: A recording survives navigation within the page
An encoded recording and its result view SHALL survive switching between the Record and Decode tabs and switching the layout ethos. The microphone SHALL remain armed across both.

#### Scenario: Visiting the Decode tab and returning
- **WHEN** the user records a message, opens the Decode tab, and returns to the Record tab
- **THEN** the QR result is still shown
- **AND** the record button is still armed without re-enabling the microphone

#### Scenario: Changing the layout ethos
- **WHEN** the user records a message and switches the layout ethos in settings
- **THEN** the QR result is shown in the new layout
- **AND** the record button is still armed without re-enabling the microphone

### Requirement: A loaded packet survives navigation within the page
A packet loaded on the Decode tab SHALL survive switching to the Record tab and back, and SHALL retain its decoder selection, whichever source it arrived from.

#### Scenario: A pasted packet after a tab round trip
- **WHEN** the user loads a packet through the hex source, opens the Record tab, and returns
- **THEN** the same packet is still loaded in the player

#### Scenario: A decoder override after a tab round trip
- **WHEN** the user overrides the decoder for a packet, opens the Record tab, and returns
- **THEN** the override is still selected

### Requirement: A voice link opens the Decode tab however it is reached
When the page is asked to show a voice payload, the Decode tab SHALL be selected, whether the page was loaded fresh or navigated to within the application.

#### Scenario: In-app navigation to a voice link
- **WHEN** the application navigates to a voice URL without a full page load
- **THEN** the Decode tab is selected and the packet is loaded

### Requirement: Capture devices are released when the page is left
Leaving the QR page SHALL stop the microphone capture track and close the recording audio context.

#### Scenario: Navigating away
- **WHEN** the user arms the microphone and then navigates to another page
- **THEN** the capture track is stopped
- **AND** the recording audio context is closed

### Requirement: At most one capture track and one recording context exist
The application SHALL hold at most one live microphone capture track and at most one open recording audio context at a time, regardless of how the user has moved between tabs and layouts.

#### Scenario: Arming after a layout change
- **WHEN** the user arms the microphone, switches layout ethos, and records again
- **THEN** exactly one capture track is live
- **AND** at most one recording audio context is open

### Requirement: Reload restores only what the URL and stored preferences carry
After a page reload the application SHALL restore a packet carried in the URL and the user's stored preferences, and SHALL NOT claim to restore session state it did not persist.

#### Scenario: Reloading a voice link
- **WHEN** the user reloads a page opened from a voice URL
- **THEN** the packet is loaded again and the Decode tab is selected

#### Scenario: Reloading after pasting a packet
- **WHEN** the user reloads after loading a packet through the hex source
- **THEN** no packet is loaded and the page opens on the Record tab
