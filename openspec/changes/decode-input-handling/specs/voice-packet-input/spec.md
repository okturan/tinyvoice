## ADDED Requirements

### Requirement: The camera viewfinder receives the capture stream
When the camera is started, the live stream SHALL be attached to the viewfinder that is shown to the user, and frames SHALL be available for scanning.

#### Scenario: Starting the camera
- **WHEN** the user starts the camera
- **THEN** the viewfinder displays the live camera image

#### Scenario: Scanning a voice QR
- **WHEN** a voice QR code is in view of the running camera
- **THEN** the packet it encodes is loaded into the player
- **AND** the camera stops

#### Scenario: A QR without voice data
- **WHEN** the camera reads a QR code that does not carry voice data
- **THEN** the user is told the code did not contain voice data

### Requirement: Every failed input reports why
Each way of supplying a packet SHALL report a visible reason when it fails, whether the payload was unreadable, was not a voice packet, was an image that could not be decoded, or was an image containing no QR code.

#### Scenario: An unreadable share link
- **WHEN** the page is opened with a voice payload that cannot be decoded
- **THEN** the Decode tab shows a message explaining the link did not carry voice data

#### Scenario: Well-formed data that is not a packet
- **WHEN** the payload decodes but is not a valid voice packet
- **THEN** the user is told it is not voice data

#### Scenario: An image that cannot be decoded
- **WHEN** the user uploads a file with an image type that the browser cannot decode
- **THEN** the user is told the image could not be read

#### Scenario: An image with no QR code
- **WHEN** the user uploads an image containing no QR code
- **THEN** the user is told no QR code was found

### Requirement: Payload size is bounded on every input
The maximum accepted packet size SHALL apply to every input path — shared links, pasted hex, and uploaded files alike. An oversized payload SHALL be refused with a message and SHALL NOT be rendered.

#### Scenario: An oversized uploaded file
- **WHEN** the user uploads a file larger than the accepted packet size
- **THEN** the file is refused with a message
- **AND** no player is shown for it

#### Scenario: Oversized pasted hex
- **WHEN** the user submits hexadecimal input larger than the accepted packet size
- **THEN** the input is refused with a message

#### Scenario: A payload at the limit
- **WHEN** the user supplies a packet within the accepted size
- **THEN** it loads normally

### Requirement: The application's own exported files load again
A file produced by the application's hex export SHALL be accepted by the upload input and SHALL load the packet it represents.

#### Scenario: Round-tripping an exported hex file
- **WHEN** the user saves a recording's hex export and uploads that file on the Decode tab
- **THEN** the same packet is loaded

### Requirement: A failed input leaves the loaded packet alone
When an input fails, the packet that is already loaded SHALL remain loaded, and the failure SHALL be reported alongside it. This SHALL hold for every input path.

#### Scenario: A bad file while a packet is loaded
- **WHEN** a packet is loaded and the user uploads a file that is not a valid packet
- **THEN** the error is shown
- **AND** the previously loaded packet is still in the player

#### Scenario: Bad hex while a packet is loaded
- **WHEN** a packet is loaded and the user submits hexadecimal input that is not a valid packet
- **THEN** the error is shown
- **AND** the previously loaded packet is still in the player

### Requirement: Input resources are released
Resources created to read an input, such as object URLs for uploaded images, SHALL be released once the read completes or fails.

#### Scenario: Uploading several images
- **WHEN** the user uploads images repeatedly
- **THEN** no object URL created for a completed read is left allocated
