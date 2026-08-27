## Context

`CodecContext` owns one notion of readiness — `loadedQualities: Quality[]`, populated by `codec.loadModelSet()`, which always loads the shared encoder plus the requested quality's compressor and decoder. Every consumer asks the same question (`isQualityLoaded(q)`) regardless of whether it intends to record or to play, so the Decode player downloads ~812 MB to run a ~141 MB decoder.

The service layer underneath is already finer-grained: `codec-service` caches sessions per artifact and `decodeFromTokens()` lazily loads a decoder on its own. `QRResult`'s Preview exploits that directly, which is why a preview override loads a decoder the context never learns about.

Three further problems share the same root. `loadModels` rethrows into callers that have no `catch`; one `AbortController` is cleared in a `finally` that runs later than the state it guards; and progress callbacks from a superseded load keep writing `statusText`. Separately, four surfaces (`useRecordFlow`, `QualityPicker`, `ModelDownloadDialog`, `ModelManagement`) each hold their own `areCached` snapshot with different refresh triggers and different definitions of "cached".

The `e2e/` audit suite already encodes the target behaviour: 13 `test.fail()` tests in this area assert the corrected outcomes.

## Goals / Non-Goals

**Goals:**
- Make the artifacts a load fetches match the capability the user asked for.
- Give every download surface a truthful, visible outcome: progress, error, or cancellation.
- Make Cancel and Delete actually stop work in flight.
- Reduce cached-state to one record with one refresh path.
- Keep `PTTPage` working through the same context without special-casing.

**Non-Goals:**
- Changing the wire format, model artifacts, `MODEL_REVISION`, or the IndexedDB cache format.
- Redesigning the download dialog's layout or the settings panel's information architecture.
- Making the models smaller, or splitting artifacts further than encoder / compressor / decoder.
- Concurrency: one load at a time remains the design. Only its labelling and cancellation change.

## Decisions

### D1 — Two capability predicates, one derived set

`CodecContext` exposes `canRecord(q)` (shared encoder + `compressor_q`) and `canPlay(q)` (`decoder_q`). `loadedQualities` survives as the derived set where both hold, which is exactly what PTT rooms need, so `PTTPage` keeps its current reads.

Internally the context tracks resident artifacts rather than qualities: `encoderLoaded: boolean`, `loadedCompressors: Set<Quality>`, `loadedDecoders: Set<Quality>`. Predicates derive from those.

*Alternative considered*: keep `loadedQualities` and add a parallel `loadedDecoders`. Rejected — two overlapping notions of loaded is what produced this class of bug in the first place.

### D2 — Loads are requested by intent, not by quality

`loadModels(quality, intent)` where intent is `"record" | "play" | "both"`, replacing the current always-all-three behaviour. Call sites:

| Caller | Intent | Artifacts |
| --- | --- | --- |
| Decode player download / Play | `play` | `decoder_q` |
| Record tab codec card | `record` | encoder + `compressor_q` |
| Record result Preview | `play` | `decoder_q` |
| PTT room quality lock | `both` | all three |
| Settings → Choose models | `both` | all three |

`ModelDownloadDialog` takes the intent as a prop so its per-row size reflects what pressing the button will actually fetch. Settings keeps `both` — a user opening the model manager is provisioning the app, not satisfying one action.

*Alternative considered*: infer intent from which surface called. Rejected as implicit; an explicit parameter is what makes the dialog's pricing honest.

### D3 — Preview goes through the context

`QRResult.preview` stops calling `codec.decode()` directly. It asks the context for `canPlay(effectiveQuality)`, offers a decoder download when false, and decodes afterwards. The Record tab therefore gains a decoder-download step that did not exist before — the deliberate cost of dropping the record bundle to encoder + compressor.

### D4 — `loadModels` resolves, never rejects

```
loadModels(q, intent) -> Promise<{ ok: true } | { ok: false; reason: "cancelled" | "busy" | "error"; message?: string }>
```

Failures set `state: "error"` and `errorText` on the context; callers may ignore the result and still behave correctly. `ModelDownloadDialog`, the record codec card, `DecodePlayer` and the settings panel all render `errorText`. `PTTPage`'s existing `.catch()` becomes redundant but harmless.

*Alternative considered*: keep throwing and add `try/catch` at five call sites. Rejected — the next call site added would reintroduce the bug.

### D5 — One generation counter for loads

The context holds `loadGenerationRef`. A load captures its generation; progress, success and failure apply only while `loadGenerationRef.current === generation`. `abortLoading()` and `clearModelCache()` bump the generation and abort the controller. This is the same fence `DecodePlayer` already uses for playback, applied to loading.

Three consequences fall out for free: late progress cannot overwrite an error (a sibling still streaming after a failure), a late completion cannot resurrect a cancelled load, and a load that resolves after the cache was cleared cannot mark models available.

The controller reference is cleared **synchronously** inside `abortLoading()` rather than in `loadModels`'s `finally`, so the click that follows a Cancel is not refused as busy.

### D6 — Abort checks bracket session creation

`codec-service.createSession()` currently checks `signal.aborted` only before `InferenceSession.create()`. It gains a check after creation as well, and `loadModelSet` checks once more before reporting success. A cancel issued while ONNX is initialising then reports cancelled instead of resolving into "loaded".

### D7 — First failure aborts the load

`loadModelSet` runs artifacts through `Promise.all`. The context's catch calls `controller.abort()` before recording the error, so siblings stop rather than continuing to stream and report. Combined with D5, the error is what remains on screen.

### D8 — Parse failures are scoped to the artifact

The current catch clears the entire IndexedDB store whenever the error message contains `"protobuf"`. It becomes `delCache(name)` for the artifact that failed, using the model name the loader already threads through `ModelLoadProgress`. `codec.reset()` is called for that artifact's session so a retry rebuilds it.

### D9 — Cached state lives in the context

`CodecContext` owns `cachedFiles: Set<string>` plus `refreshCache()`, seeded on mount and refreshed after every download, delete, and clear. `useModelCache` becomes a thin read of that state so existing consumers keep their shape. Derived helpers `isCachedForRecording(q)` and `isCachedForPlayback(q)` replace the three different ad-hoc definitions, and the startup probe iterates all qualities instead of defaulting to 50 Hz.

## Risks / Trade-offs

- **Preview now waits for a download** → The record path no longer implies a decoder. Mitigated by making the wait explicit and consistent with the Decode player's existing affordance, and by the dialog quoting the smaller record price. This was chosen deliberately over keeping the decoder in the record bundle.
- **`CodecContext`'s contract changes and `PTTPage` depends on it** → `loadedQualities` and `isQualityLoaded` are preserved with identical semantics (both halves loaded), so PTT compiles and behaves unchanged. PTT's room-lock path is covered by the "room requires both halves" scenario.
- **A large slice of the e2e suite asserts today's behaviour** → Roughly 13 `test.fail()` tests flip to passing, and a further group of passing tests deliberately pins the current fetch sets with `// NOTE:` comments. Both groups are updated in this change; the suite going red is the signal that a fix landed, not a regression. Tasks enumerate them.
- **Generation fencing can hide a genuine late error** → Only failures from a superseded load are dropped, and a superseded load is by definition one the user cancelled or replaced. The active load's failures always surface.
- **Intent threading could drift** → The dialog's quoted size derives from the same intent value that the load uses, so a mismatch shows up as a wrong price in the dialog and is covered by the pricing scenarios.

## Migration Plan

No data migration: the cache format, keys and `MODEL_REVISION` are untouched, so an existing user's cached models remain valid and are simply recognised per artifact instead of per quality.

Ordering that keeps the tree green between steps:

1. Cached-state consolidation (D9) — no behaviour change, unblocks honest pricing.
2. Error, abort and generation correctness (D4–D8) — no capability change.
3. Capability split (D1–D3) — the user-visible change; e2e updates land with it.

Rollback is per step; each is independently revertible because steps 1 and 2 leave the public predicates alone.

## Open Questions

- Should the settings panel's status line enumerate capabilities ("12.5 Hz: record + play") rather than the current "<quality> loaded" phrasing? The specs require the report to be truthful, not a particular wording.
- When a user records at a quality and previews it, should the app offer to cache the decoder for next time, or download it silently each session? Current design downloads on demand and caches as a side effect of the normal loader.
