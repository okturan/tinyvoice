## ADDED Requirements

### Requirement: Capabilities declare the artifacts they need
The system SHALL treat recording and playback as separate capabilities, each requiring only the model artifacts it runs. Recording at a quality SHALL require the shared encoder and that quality's compressor. Playback at a quality SHALL require that quality's decoder. The system SHALL NOT report a capability as available unless every artifact it requires is resident.

#### Scenario: Playback capability ignores the encoder
- **WHEN** only `decoder_25hz.onnx` is resident
- **THEN** the app reports that it can play 25 Hz packets
- **AND** the app reports that it cannot record at 25 Hz

#### Scenario: Recording capability ignores the decoder
- **WHEN** only the shared encoder and `compressor_25hz.onnx` are resident
- **THEN** the app reports that it can record at 25 Hz
- **AND** the app reports that it cannot play 25 Hz packets

#### Scenario: A room requires both halves
- **WHEN** a PTT room is locked to a quality
- **THEN** the app requires both the recording and the playback artifacts for that quality before the room is ready

### Requirement: Playback downloads only a decoder
When the user plays a received voice packet and the required decoder is absent, the system SHALL download that decoder alone, and SHALL NOT download the shared encoder or any compressor.

#### Scenario: Playing a packet with nothing loaded
- **WHEN** the user opens a voice link with no models resident and presses Play
- **THEN** only the packet quality's decoder is requested from the model host
- **AND** the packet decodes and plays

#### Scenario: The download prompt names the decoder and its size
- **WHEN** a packet's decoder is absent
- **THEN** the download control names the decoder for that quality and the download size it will incur

### Requirement: Recording downloads only the encoder and compressor
When the user arms the Record tab for a quality, the system SHALL download the shared encoder and that quality's compressor, and SHALL NOT download that quality's decoder.

#### Scenario: Arming the record tab
- **WHEN** the user chooses models for 12.5 Hz from the Record tab with nothing cached
- **THEN** only the shared encoder and `compressor_12_5hz.onnx` are requested
- **AND** the offered download size reflects those two artifacts

#### Scenario: Previewing a recording needs a decoder
- **WHEN** the user previews a recording whose decoder is absent
- **THEN** the result view offers to download that decoder
- **AND** starting playback from that control downloads the decoder alone

### Requirement: All model loads register with the application's model state
Every model load SHALL be recorded in the application's model state, whichever surface initiates it. No surface may load a model in a way that leaves the app reporting that model as absent.

#### Scenario: A preview override loads a decoder
- **WHEN** the user previews a recording with a decoder override for a quality that was not resident
- **THEN** after the preview the app reports that it can play that quality
- **AND** the Decode tab does not offer to download that same decoder again

### Requirement: Download failures are reported to the user
A failed model download SHALL leave a human-readable error on the application's model state, and every surface that can start a download SHALL display it. A failure SHALL NOT surface as an uncaught promise rejection.

#### Scenario: The model host returns an error
- **WHEN** a download fails with an HTTP error
- **THEN** the surface that started the download shows a message naming the failure
- **AND** no uncaught error reaches the page

#### Scenario: Retrying after a failure
- **WHEN** the user retries a download that previously failed
- **THEN** the download proceeds without requiring a page reload
- **AND** the error message is cleared once the retry starts

### Requirement: A failed artifact stops its siblings
When one artifact of a multi-artifact load fails, the system SHALL abort the remaining downloads of that load and SHALL leave the failure as the reported outcome.

#### Scenario: One of several artifacts fails
- **WHEN** the encoder download fails while a compressor is still downloading
- **THEN** the remaining download is aborted
- **AND** the reported status remains the failure, not the progress of the aborted sibling

### Requirement: Superseded loads cannot write status
Progress, success and failure reported by a load that has been cancelled, superseded, or already failed SHALL be discarded rather than applied to the application's model state.

#### Scenario: Late progress after a failure
- **WHEN** a load has failed and a slower sibling later reports progress
- **THEN** the reported status still describes the failure

#### Scenario: Late completion after a cancellation
- **WHEN** the user cancels a load and an in-flight artifact later completes
- **THEN** the app still reports the load as cancelled
- **AND** the app does not report that quality as available

### Requirement: Cancelling a download is honoured at every stage
A cancellation SHALL take effect whether the load is awaiting the network, reading the cache, or creating an inference session. After a cancellation the app SHALL NOT report the cancelled models as available.

#### Scenario: Cancelling during session creation
- **WHEN** the user cancels while the downloaded models are being initialised
- **THEN** the status reports the cancellation
- **AND** the app does not later report those models as loaded

### Requirement: Cancelling frees the loader immediately
After the user cancels a download, the next attempt to load models SHALL start a new download rather than be refused as already busy.

#### Scenario: Restarting right after a cancel
- **WHEN** the user cancels a download and immediately starts the same download again
- **THEN** a new download begins
- **AND** the app does not report the second attempt as cancelled

### Requirement: Clearing the cache stops a download in flight
Deleting the downloaded models SHALL abort any load in progress. No download that was running at the time of the deletion may repopulate the cache or mark models as available afterwards.

#### Scenario: Deleting models mid-download
- **WHEN** the user deletes the downloaded models while a download is running
- **THEN** the download is aborted
- **AND** the app continues to report that no models are available
- **AND** the model cache stays empty

### Requirement: A malformed artifact is dropped on its own
When a model artifact fails to parse, the system SHALL discard that artifact from the cache and SHALL leave every other cached artifact intact.

#### Scenario: One quality fails to parse
- **WHEN** a compressor fails to parse while another quality's models are cached
- **THEN** only the artifact that failed to parse is removed from the cache
- **AND** the other quality is still reported as cached
