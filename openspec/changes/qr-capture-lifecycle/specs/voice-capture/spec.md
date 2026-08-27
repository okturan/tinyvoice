## ADDED Requirements

### Requirement: A release always ends the take that started it
A press that is released before its recording setup finishes SHALL tear that setup down. No audio node, timer or capture started by an abandoned press may remain running, and it SHALL NOT contribute audio to a later take.

#### Scenario: Releasing during setup
- **WHEN** the user presses and releases the record button before the recorder finishes arming
- **THEN** the recorder returns to idle and reports that the take was too short
- **AND** no recording timer keeps running while the recorder is idle

#### Scenario: The next take is unaffected
- **WHEN** the user records normally after such an abandoned press
- **THEN** the recording's reported length matches how long the button was held

### Requirement: A new take cannot start while one is encoding
The record control SHALL be inert from the moment a take is released until the recorder returns to idle. A press during encoding SHALL NOT start a second capture.

#### Scenario: Pressing during encoding
- **WHEN** the user presses the record button while the previous take is being encoded
- **THEN** no new capture starts
- **AND** the encode completes and produces its result

### Requirement: Microphone failures during a hold are reported as such
When the microphone cannot be acquired at the start of a take, the system SHALL report a microphone error and return the recorder to idle. It SHALL NOT report the failure as a too-short recording, and SHALL NOT surface it as an uncaught error.

#### Scenario: The microphone is lost between takes
- **WHEN** the previously granted capture track has ended and re-acquisition is refused
- **THEN** the record surface shows an error naming the microphone problem
- **AND** the recorder is idle and can be tried again
- **AND** no uncaught error reaches the page

### Requirement: Encode failures leave no residual progress
When encoding fails, the system SHALL report the error and clear any encode progress indicator.

#### Scenario: The encoder rejects
- **WHEN** encoding fails
- **THEN** the error is shown on the record surface
- **AND** no encode progress indicator remains
- **AND** the record control is armed again

### Requirement: Status text describes the current state truthfully
The record surface SHALL NOT claim that models are loaded when they are not, and SHALL NOT present informational text with the emphasis reserved for errors.

#### Scenario: Starting a new recording after models were deleted
- **WHEN** the user deletes the downloaded models and then starts a new recording from the result view
- **THEN** the surface does not claim any quality is loaded

#### Scenario: An informational message after an error
- **WHEN** an error message is shown and the user then changes quality, producing an informational message
- **THEN** the informational message is not presented as an error

### Requirement: The encode status names qualities the way the rest of the app does
Quality names shown to the user during encoding SHALL use the same display labels as every other surface.

#### Scenario: Encoding at the smallest quality
- **WHEN** a recording is encoded at 12.5 Hz
- **THEN** the status names it "12.5hz", matching the quality picker and the codec status

### Requirement: Quality selection is locked while models load
While a model load is running, the quality selection SHALL be disabled, so a load cannot complete against a quality the user has since changed.

#### Scenario: Changing quality mid-load
- **WHEN** a model load is in progress
- **THEN** the quality options cannot be changed until the load finishes or is cancelled
