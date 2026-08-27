## ADDED Requirements

### Requirement: One record of what is cached
The application SHALL keep a single record of which model files are present in the browser cache, and every surface that displays cached state SHALL read from that record. Surfaces SHALL NOT maintain independent snapshots.

#### Scenario: Two surfaces agree
- **WHEN** the model inventory and the download dialog are shown at the same time
- **THEN** both describe the same set of files as cached

### Requirement: Cached state refreshes after every mutation
Any action that adds or removes cached model files — completing a download, deleting one file, or deleting all downloaded models — SHALL refresh the cached-state record so that every open surface reflects the result without being reopened or the page reloaded.

#### Scenario: Downloading from the dialog
- **WHEN** the user downloads models from the dialog and the model inventory is visible behind it
- **THEN** the inventory shows the newly cached files and its cached total updates

#### Scenario: Deleting all downloaded models
- **WHEN** the user deletes all downloaded models
- **THEN** the model inventory shows every file as absent
- **AND** the download dialog stops offering to load those models from cache

#### Scenario: Deleting a single file
- **WHEN** the user deletes one model file from the inventory
- **THEN** any open download dialog stops describing that file as cached
- **AND** the price it quotes includes that file again

### Requirement: Cached markers describe a usable capability
A surface that marks a quality as cached SHALL do so only when every artifact required for the capability that surface controls is cached.

#### Scenario: The record tab's quality marks
- **WHEN** a quality's compressor is cached but the shared encoder is not
- **THEN** the Record tab does not mark that quality as ready to record

#### Scenario: A partially cached quality is priced honestly
- **WHEN** some of a quality's required artifacts are cached
- **THEN** the offered download names what is still missing and prices only that

### Requirement: The startup cache probe covers every quality
On startup the application SHALL determine cached state across all supported qualities, and SHALL report cached models as available whichever quality was cached.

#### Scenario: Only a non-default quality is cached
- **WHEN** the page loads with only 12.5 Hz models cached
- **THEN** the settings panel reports that cached models are available
- **AND** its report agrees with the Record tab's

### Requirement: Destructive cache actions confirm consistently
Every control that deletes all downloaded models SHALL require the same explicit confirmation before deleting.

#### Scenario: Deleting from the model inventory
- **WHEN** the user activates the inventory's delete-everything control
- **THEN** the control asks for confirmation before any file is deleted
- **AND** the cache is unchanged until the user confirms
