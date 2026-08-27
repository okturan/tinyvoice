## ADDED Requirements

### Requirement: The decoder selection belongs to the packet being played
A decoder chosen for one packet SHALL NOT carry over to the next. When a new packet is loaded, the selection SHALL return to the packet's own quality.

#### Scenario: Loading a new packet after an override
- **WHEN** the user overrides the decoder for a packet and then loads a different packet
- **THEN** the new packet's own quality is selected
- **AND** the estimated duration and any download prompt describe that quality

#### Scenario: The new packet matches the previous override
- **WHEN** the newly loaded packet's quality equals the decoder previously chosen
- **THEN** a decoder is still shown as selected

### Requirement: Choosing the active decoder again does nothing
Selecting the decoder that is already in use SHALL leave playback and the decoded audio untouched.

#### Scenario: Re-selecting during playback
- **WHEN** the user selects the decoder that is already active while a packet is playing
- **THEN** playback continues
- **AND** the next play does not decode the packet again

### Requirement: Progress indicators reflect current progress only
A progress indicator SHALL be shown only while there is work in progress, and SHALL be cleared when that work completes, fails, or is cancelled.

#### Scenario: After a successful decode
- **WHEN** a packet finishes decoding and plays
- **THEN** no decode progress indicator remains

#### Scenario: After a failed decode
- **WHEN** decoding fails
- **THEN** the error is shown
- **AND** no decode progress indicator remains

### Requirement: Progress is exposed to assistive technology
A progress indicator SHALL expose its current value to assistive technology rather than presenting as indeterminate.

#### Scenario: A determinate progress bar
- **WHEN** a progress indicator is shown for work whose completion fraction is known
- **THEN** its accessible value reflects that fraction

### Requirement: Status text describes the current state
The player's status SHALL describe what is true at the time it is shown, and SHALL NOT continue to claim an activity that has finished.

#### Scenario: After a download completes
- **WHEN** a model download started from the player completes
- **THEN** the status no longer says a download is in progress
