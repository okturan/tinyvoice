## 1. Cached state consolidation (design D9)

- [ ] 1.1 Add `cachedFiles: Set<string>` and `refreshCache()` to `CodecContext`, seeded on mount from `getAllCachedKeys()`.
- [ ] 1.2 Add derived helpers `isCachedForRecording(q)` (encoder + `compressor_q`) and `isCachedForPlayback(q)` (`decoder_q`) to the context.
- [ ] 1.3 Make the startup probe iterate every quality instead of defaulting to `Quality.Hz50`, so a cached non-default quality is announced.
- [ ] 1.4 Reduce `useModelCache` to a read of the context state, keeping its current return shape so consumers are untouched.
- [ ] 1.5 Point `ModelDownloadDialog`, `ModelManagement`, `QualityPicker` and `useRecordFlow` at the context's cached state; delete their independent `areCached` snapshots.
- [ ] 1.6 Call `refreshCache()` after every download, per-file delete, and full cache clear.
- [ ] 1.7 Give the model inventory's "Delete downloaded models" the same two-step confirmation the settings codec section uses.
- [ ] 1.8 Verify: `models-lifecycle` "the inventory in the same sheet picks up a download made from its dialog", "the inventory below reflects the wipe", "the download dialog reflects the wipe", "the download dialog in the same sheet reflects the per-file delete", "the sheet announces a cached 12.5hz set after a reload"; `record-flow` "the codec card notices the encoder deleted from Settings without a quality change", "the record tab's dialog notices a model file deleted from Settings" — remove `test.fail()` from each.

## 2. Load fencing, cancellation and errors (design D4–D8)

- [ ] 2.1 Add `loadGenerationRef` to `CodecContext`; apply progress, success and failure only while the generation still matches.
- [ ] 2.2 Change `loadModels` to resolve to `{ ok: true } | { ok: false; reason: "cancelled" | "busy" | "error"; message? }` and never reject; add `errorText` to the context value.
- [ ] 2.3 Abort the load's `AbortController` in the failure path so siblings stop streaming.
- [ ] 2.4 Clear the controller reference synchronously inside `abortLoading()` instead of in `loadModels`'s `finally`.
- [ ] 2.5 Make `clearModelCache()` bump the generation and abort any in-flight load before wiping.
- [ ] 2.6 Add an abort check after `InferenceSession.create()` in `codec-service.createSession()`, and once more before `loadModelSet` reports success.
- [ ] 2.7 Replace the blanket cache wipe on `"protobuf"` errors with `delCache(<failing artifact>)` plus a reset of that artifact's cached session.
- [ ] 2.8 Render `errorText` in `ModelDownloadDialog`, the Record tab's codec card, `DecodePlayer`, and the settings codec section; drop the uncaught-rejection paths.
- [ ] 2.9 Clear `errorText` when a new load starts.
- [ ] 2.10 Verify: `models-gaps` all four tests; `models-lifecycle` "Error stays on screen while the sibling downloads finish", "a failed download is reported without an uncaught page error"; `decode-player` "Settings keeps reporting a failed load as an error", "a failed download from the player's Download button is reported in red, not swallowed", "after the player's own Download finishes, the status line stops claiming to download"; `record-flow` "a failed download re-arms the dialog and tells the user what went wrong without throwing" — remove `test.fail()` from each.

## 3. Capability split (design D1–D3)

- [ ] 3.1 Track resident artifacts in `CodecContext` as `encoderLoaded`, `loadedCompressors`, `loadedDecoders` instead of `loadedQualities`.
- [ ] 3.2 Expose `canRecord(q)` and `canPlay(q)`; derive `loadedQualities` and `isQualityLoaded(q)` from both halves so `PTTPage` is unchanged.
- [ ] 3.3 Add an `intent: "record" | "play" | "both"` parameter to `loadModels`; map it to the artifact set in `codec-service.loadModelSet`.
- [ ] 3.4 Point `DecodePlayer` at `canPlay` / `loadModels(q, "play")`; relabel its download control to name the decoder and its size.
- [ ] 3.5 Point the Record tab (`useRecordFlow`, codec card) at `canRecord` / `loadModels(q, "record")`.
- [ ] 3.6 Route `QRResult.preview` through the context: check `canPlay`, offer a decoder download when absent, then decode.
- [ ] 3.7 Pass the intent into `ModelDownloadDialog` so each row's quoted size matches what the button fetches; Settings keeps `"both"`, the Record tab passes `"record"`.
- [ ] 3.8 Keep the PTT room-lock path on `loadModels(q, "both")` and confirm the room readiness gate still requires both halves.
- [ ] 3.9 Verify: `decode-cross-quality` cross-quality matrix still passes with decoder-only fetch sets.

## 4. Test suite reconciliation

- [ ] 4.1 Invert the passing tests that pin the full-set fetch behaviour: `decode-cross-quality` "nothing loaded" matrix (three qualities) and the "another quality is loaded" fetch assertions, so they expect decoder-only requests.
- [ ] 4.2 Invert `decode-player`'s fetch-set assertions on Play and on the player's Download button.
- [ ] 4.3 Invert `record-result` "after a 50hz preview override, Decode still asks for the 50hz models (current behaviour)" and the Settings "12.5hz loaded" note — a preview-loaded decoder now registers.
- [ ] 4.4 Update `record-flow` assertions that expect the decoder in `models.requests` / `ortState().sessions` when arming the Record tab, and the dialog's quoted sizes (record intent no longer includes the decoder).
- [ ] 4.5 Add a test that previewing a recording whose decoder is absent offers a decoder download and plays after it.
- [ ] 4.6 Update `e2e/README.md` where it describes what a Play downloads.

## 5. Validation

- [ ] 5.1 `npm run typecheck` clean.
- [ ] 5.2 `npm test` clean (unit + worker runtime).
- [ ] 5.3 `npm run test:e2e` — 0 unexpected failures, 0 flaky, and the 17 tests listed in 1.8 / 2.10 no longer carry `test.fail()`.
- [ ] 5.4 Confirm by inspection of `models.requests` in the suite that playing a received packet fetches one artifact and arming the Record tab fetches two.
- [ ] 5.5 Update `CLAUDE.md`'s architecture notes where they describe model loading as per-quality.
