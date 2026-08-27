## 1. Cached state consolidation (design D9)

- [x] 1.1 Add `cachedFiles: Set<string>` and `refreshCache()` to `CodecContext`, seeded on mount from `getAllCachedKeys()`.
- [x] 1.2 Add derived helpers `isCachedForRecording(q)` (encoder + `compressor_q`) and `isCachedForPlayback(q)` (`decoder_q`) to the context.
- [x] 1.3 Make the startup probe iterate every quality instead of defaulting to `Quality.Hz50`, so a cached non-default quality is announced.
- [x] 1.4 Reduce `useModelCache` to a read of the context state, keeping its current return shape so consumers are untouched.
- [x] 1.5 Point `ModelDownloadDialog`, `ModelManagement`, `QualityPicker` and `useRecordFlow` at the context's cached state; delete their independent `areCached` snapshots.
- [x] 1.6 Call `refreshCache()` after every download, per-file delete, and full cache clear.
- [x] 1.7 Give the model inventory's "Delete downloaded models" the same two-step confirmation the settings codec section uses.
- [x] 1.8 Verify: `models-lifecycle` "the inventory in the same sheet picks up a download made from its dialog", "the inventory below reflects the wipe", "the download dialog reflects the wipe", "the download dialog in the same sheet reflects the per-file delete", "the sheet announces a cached 12.5hz set after a reload"; `record-flow` "the codec card notices the encoder deleted from Settings without a quality change", "the record tab's dialog notices a model file deleted from Settings" — remove `test.fail()` from each.

## 2. Load fencing, cancellation and errors (design D4–D8)

- [x] 2.1 Add `loadGenerationRef` to `CodecContext`; apply progress, success and failure only while the generation still matches.
- [x] 2.2 Change `loadModels` to resolve to `{ ok: true } | { ok: false; reason: "cancelled" | "busy" | "error"; message? }` and never reject; add `errorText` to the context value.
- [x] 2.3 Abort the load's `AbortController` in the failure path so siblings stop streaming.
- [x] 2.4 Clear the controller reference synchronously inside `abortLoading()` instead of in `loadModels`'s `finally`.
- [x] 2.5 Make `clearModelCache()` bump the generation and abort any in-flight load before wiping.
- [x] 2.6 Add an abort check after `InferenceSession.create()` in `codec-service.createSession()`, and once more before `loadModelSet` reports success.
- [x] 2.7 Replace the blanket cache wipe on `"protobuf"` errors with `delCache(<failing artifact>)` plus a reset of that artifact's cached session.
- [x] 2.8 Render `errorText` in `ModelDownloadDialog`, the Record tab's codec card, `DecodePlayer`, and the settings codec section; drop the uncaught-rejection paths.
- [x] 2.9 Clear `errorText` when a new load starts.
- [x] 2.10 Verify: `models-gaps` all four tests; `models-lifecycle` "Error stays on screen while the sibling downloads finish", "a failed download is reported without an uncaught page error"; `decode-player` "Settings keeps reporting a failed load as an error", "a failed download from the player's Download button is reported in red, not swallowed", "after the player's own Download finishes, the status line stops claiming to download"; `record-flow` "a failed download re-arms the dialog and tells the user what went wrong without throwing" — remove `test.fail()` from each.

## 3. Capability split (design D1–D3)

- [x] 3.1 Track resident artifacts in `CodecContext` as `encoderLoaded`, `loadedCompressors`, `loadedDecoders` instead of `loadedQualities`.
- [x] 3.2 Expose `canRecord(q)` and `canPlay(q)`; derive `loadedQualities` and `isQualityLoaded(q)` from both halves so `PTTPage` is unchanged.
- [x] 3.3 Add an `intent: "record" | "play" | "both"` parameter to `loadModels`; map it to the artifact set in `codec-service.loadModelSet`.
- [x] 3.4 Point `DecodePlayer` at `canPlay` / `loadModels(q, "play")`; relabel its download control to name the decoder and its size.
- [x] 3.5 Point the Record tab (`useRecordFlow`, codec card) at `canRecord` / `loadModels(q, "record")`.
- [x] 3.6 Route `QRResult.preview` through the context: check `canPlay`, offer a decoder download when absent, then decode.
- [x] 3.7 Pass the intent into `ModelDownloadDialog` so each row's quoted size matches what the button fetches; Settings keeps `"both"`, the Record tab passes `"record"`.
- [x] 3.8 Keep the PTT room-lock path on `loadModels(q, "both")` and confirm the room readiness gate still requires both halves.
- [x] 3.9 Verify: `decode-cross-quality` cross-quality matrix still passes with decoder-only fetch sets.

## 4. Test suite reconciliation

- [x] 4.1 Invert the passing tests that pin the full-set fetch behaviour: `decode-cross-quality` "nothing loaded" matrix (three qualities) and the "another quality is loaded" fetch assertions, so they expect decoder-only requests.
- [x] 4.2 Invert `decode-player`'s fetch-set assertions on Play and on the player's Download button.
- [x] 4.3 Invert `record-result` "after a 50hz preview override, Decode still asks for the 50hz models (current behaviour)" and the Settings "12.5hz loaded" note — a preview-loaded decoder now registers.
- [x] 4.4 Update `record-flow` assertions that expect the decoder in `models.requests` / `ortState().sessions` when arming the Record tab, and the dialog's quoted sizes (record intent no longer includes the decoder).
- [x] 4.5 Add a test that previewing a recording whose decoder is absent offers a decoder download and plays after it.
- [x] 4.6 Update `e2e/README.md` where it describes what a Play downloads.

## 5. Validation

- [x] 5.1 `npm run typecheck` clean.
- [x] 5.2 `npm test` clean (unit + worker runtime).
- [x] 5.3 `npm run test:e2e` — 0 unexpected failures, 0 flaky, and the 17 tests listed in 1.8 / 2.10 no longer carry `test.fail()`.
- [x] 5.4 Confirm by inspection of `models.requests` in the suite that playing a received packet fetches one artifact and arming the Record tab fetches two.
- [x] 5.5 Update `CLAUDE.md`'s architecture notes where they describe model loading as per-quality.
