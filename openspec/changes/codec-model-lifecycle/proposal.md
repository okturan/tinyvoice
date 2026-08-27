## Why

Playing a voice QR someone shared with you downloads ~812 MB of models, although decoding needs only the ~141 MB decoder — the recipient pays for a 595 MB encoder they will never run. The same context conflates "loaded" with "loadable", so a failed download disappears into an uncaught promise rejection, Cancel and Delete do not actually stop work in flight, and four surfaces disagree about what is cached. An end-to-end audit of `/qr` pinned 13 defects to this one area, each with a Playwright test that already asserts the corrected behaviour.

## What Changes

- **BREAKING** `CodecContext` replaces the single `isQualityLoaded(q)` / `loadedQualities` notion of "loaded" with two capabilities that match what the models actually do:
  - `canRecord(q)` — shared encoder + `compressor_q` (~671 MB)
  - `canPlay(q)` — `decoder_q` (~141 MB)
  - `loadedQualities` is retained as the derived `canRecord(q) && canPlay(q)` set that PTT rooms need.
- Entry points load only the artifacts their capability requires: the Decode player and the Record tab's Preview load a decoder alone; the Record tab loads encoder + compressor alone; PTT rooms load both halves. The download dialog prices each row by the capability it is opened for.
- Preview stops loading decoders behind the context's back — it routes through `CodecContext`, so what the app believes is loaded matches what is resident.
- `loadModels` no longer throws. It resolves to a result, records `errorText` on the context, and every surface that can start a download renders that error. Callers keep working if they ignore the result.
- Model loads are fenced by a generation counter, the way playback already is: the first failure aborts its siblings, and progress callbacks from a superseded load can no longer overwrite an error or a cancellation.
- Cancel and Delete become truthful: `abortLoading` releases its controller synchronously so the next click starts a new download, `clearModelCache` aborts the load it is wiping under, and a cancel issued during ONNX session creation is honoured instead of resolving into "loaded".
- A model that fails to parse is dropped from the cache on its own instead of taking every other cached quality with it.
- Cached-file state moves into the context as one source of truth that every surface reads and every mutation refreshes, replacing four independently stale snapshots. The startup cache probe recognises any cached quality rather than only 50 Hz.
- Both "Delete downloaded models" controls use the same two-step confirmation.

## Capabilities

### New Capabilities
- `codec-model-loading`: which model artifacts each capability requires, how downloads report progress, failure and cancellation, and what the app may claim is loaded.
- `model-cache-inventory`: the shared record of which model files are cached, how surfaces read it, and when it is refreshed.

### Modified Capabilities
<!-- None: openspec/specs/ is empty, so both capabilities above are new. -->

## Impact

- **Code**: `src/contexts/CodecContext.tsx` (capability split, error surface, abort correctness, cache truth), `src/lib/codec-service.ts` (per-artifact loads, abort checks after session creation), `src/components/codec/ModelDownloadDialog.tsx`, `src/components/codec/ModelManagement.tsx`, `src/components/layout/SettingsSheet.tsx`, `src/components/qr/DecodePlayer.tsx`, `src/components/qr/QRResult.tsx`, `src/components/qr/QualityPicker.tsx`, `src/hooks/useRecordFlow.ts`, `src/pages/PTTPage.tsx`.
- **Consumers**: `PTTPage` reads `isQualityLoaded`/`loadedQualities` for the room quality lock and must keep working unchanged; its behaviour is covered by the capability that requires both halves.
- **UX shift**: recording a message no longer implies a decoder is resident, so the Record tab's Preview gains a decoder-download step. This is a deliberate trade — the record download drops from ~812 MB to ~671 MB and playback from ~812 MB to ~141 MB.
- **Tests**: the `e2e/` audit suite is the acceptance criteria. Roughly 13 `test.fail()` tests flip to passing and lose their annotations; a further group of passing tests deliberately pins today's behaviour with `// NOTE:` comments (the full-set fetch assertions, "Decode still asks for the 50hz models after a Preview override", the Settings "12.5hz loaded" line) and must be inverted in the same change.
- **No change**: wire format, model artifacts and revisions, the relay, and the IndexedDB cache format.
