## Context

`QRPage` renders a Radix `Tabs` whose `TabsContent` has no `forceMount`, so the inactive panel is unmounted. The Record panel's entire state lives in `useRecordFlow`, which is called *inside* each layout variant — `RecordPanel` returns `SplitDeckRecord` or `StageSwapRecord` depending on the ethos, so changing ethos swaps the component type and discards the hook. A tab click and an ethos switch therefore both destroy the recording, the QR result, and `audioReady`. The Decode panel has the same problem: a pasted packet is lost on a tab round trip, while a `?v=` packet survives only because `QRPage` recomputes it from the URL.

`useRecordFlow`'s unmount cleanup clears the timer, animation frame, worklet and media source but never calls `track.stop()` on `micRef` or `close()` on `actxRef`, and both refs die with the unmount. Every remount that arms the microphone therefore adds a live capture track and an open AudioContext.

`recDown` sets `isRecRef.current = true` and then awaits `actx.resume()`, `audioWorklet.addModule()` and `ensureMicStream()`. A `recUp` that lands inside those awaits runs first — it flips the flag false and clears refs that are still null — and then `recDown`'s continuation wires a worklet and installs an interval that nothing will ever stop. `recDown` also has no `try/catch`, so a rejected `getUserMedia` escapes the pointer handler and the release reports "Too short — hold longer". `RecordButton` is disabled only on `!readyToRecord`, and `recDown` guards only on `isRecRef`, which `recUp` already reset — so a press during encoding starts a concurrent capture.

`DecodePlayer` already solves the same class of problem for playback with a generation counter (`playbackGenerationRef` plus an `isCurrent()` check after every await). That idiom exists in the codebase; it simply is not applied to capture.

## Goals / Non-Goals

**Goals:**
- Put session state where React will not destroy it, without keeping two panels rendered.
- Make the capture gesture safe against its own async setup and against re-entry.
- Release capture devices at a defined boundary, and hold at most one of each.
- Stop the record surface from making untrue claims.

**Non-Goals:**
- Persisting a recording or a pasted packet across a page reload. Reload restores only the URL payload and stored preferences.
- Changing the recording pipeline itself — worklet, gain, trim, and encode stay as they are.
- Redesigning either layout ethos.
- Model loading semantics, which belong to `codec-model-lifecycle`.

## Decisions

### D1 — Session state moves into providers above the tabs

```
QRPage
├── <RecordSessionProvider>   useRecordFlow() called once
├── <DecodeSessionProvider>   packet + parse error
└── <Tabs value onValueChange>
     ├── record → RecordPanel → ethos ? SplitDeckRecord : StageSwapRecord   (both read context)
     └── decode → DecodePanel                                                (reads context)
```

Both providers sit above `Tabs`, so tab switching and ethos switching are both irrelevant to them — the views may unmount freely. `RecordPanel` stops owning the hook and simply picks a presentation.

*Alternatives considered.* Hoisting `useRecordFlow` into `RecordPanel` fixes the ethos switch but not the tab switch, since `TabsContent` unmounts `RecordPanel` itself. Adding `forceMount` to both tabs fixes the tab switch but not the ethos switch, and keeps two panels rendered. Only lifting fixes both, and it fixes the Decode packet with the same move.

*Consequence.* The microphone stays armed while the user is on the Decode tab. That is the intended trade: the grant belongs to the page, not to one tab, and the release boundary becomes explicit (D3) rather than an accident of unmounting.

### D2 — Tabs become controlled

`Tabs` currently takes `defaultValue`, computed once from `?v=`. It becomes `value` / `onValueChange` with the selection derived from the presence of a voice payload, so an in-app navigation to a voice URL selects Decode instead of loading the packet behind the Record tab.

### D3 — Devices are released on page unmount

`useRecordFlow`'s cleanup gains `track.stop()` for every track on `micRef.current` and `close()` on `actxRef.current`. Because the hook now lives at page level, that cleanup runs exactly when the user leaves `/qr` — which is also what makes "at most one track, at most one context" hold: there is only ever one hook instance.

### D4 — The capture gesture gets the generation fence

`recDown` captures a generation, and after every await checks it still owns the take:

```
const generation = ++captureGenerationRef.current;
const isCurrent = () => captureGenerationRef.current === generation && isRecRef.current;
// await resume / addModule / ensureMicStream
if (!isCurrent()) { teardownPartialSetup(); return; }
```

`recUp` bumps the generation, so a release during setup invalidates the take; the continuation tears down whatever it created rather than installing an orphan. This mirrors `DecodePlayer.handlePlay`.

`recDown` is additionally wrapped in `try/catch`: a failure clears `isRecRef`, tears down partial setup, sets an error status naming the microphone problem, and returns the recorder to idle.

### D5 — The record control is inert unless idle

`RecordButton` is disabled on `!readyToRecord || recordState !== "idle"`, and `recDown` returns early unless `recordState === "idle"`. The disabled attribute is the user-visible contract; the guard covers the pointer events that arrive before React re-renders.

### D6 — Status is derived, not accumulated

Two specific corrections rather than a rewrite: `resetResult` stops writing a `<quality> loaded` line unconditionally (it may only claim that when the quality is actually loaded), and `handleQualityChange` clears `statusType` so the cache-check effect's informational text is not painted with a previous error's emphasis.

The encode status label is fixed at its source: `codec-service.encode()` interpolates the raw `Quality` enum value; it uses `qualityLabel()` like the rest of the file.

### D7 — The quality picker is disabled during a load

`QualityCard` passes a `disabled` flag through to `QualityPicker` while the codec state is loading. This removes the interleaving where `handleLoadModels` captured one quality, the user picked another, and completion wrote the old quality's "loaded" line under the new selection.

## Risks / Trade-offs

- **The microphone stays live while on the Decode tab** → The browser's recording indicator remains on for the whole `/qr` visit once armed. Accepted deliberately: the alternative is dropping the grant on every tab click, which is worse and is what users are complaining about today. The release boundary is specified and tested.
- **Lifting state changes component identity in two layouts** → Both layout variants become presentational readers of the same context, so a bug in one is a bug in both. Covered by the persistence scenarios being asserted in both ethoses.
- **Both this change and `codec-model-lifecycle` edit `useRecordFlow`** → They touch different regions (gesture and status here; capability predicates and cache reads there). Whichever lands second rebases; neither depends on the other's semantics.
- **Generation fencing could swallow a legitimate slow take** → The fence only invalidates a take whose release already happened or which a newer press superseded. A take still held is always current.
- **A page-level provider constructs recorder state even for users who only decode** → State construction is cheap and lazy; no device is touched until the user arms the microphone.

## Migration Plan

No persisted-data changes. Stored preferences (`tinyvoice-layout`, `tinyvoice-trim-silence`, mic device and gain) keep their keys and meanings.

Suggested order, each step leaving the tree green:

1. Gesture safety (D4, D5) and status corrections (D6, D7) — local to `useRecordFlow` and two components.
2. Device release (D3) — small, but only fully meaningful once the hook is lifted.
3. Lifting to providers (D1) and controlled tabs (D2) — the structural step, with the e2e persistence updates.

Rollback is per step. Step 3 is the only one that changes component structure.

## Open Questions

- Should arming the microphone be offered on the Decode tab too (it is only reachable from the Record tab today), now that the grant is page-scoped?
- Should a recording in progress be cancelled if the user manages to switch tabs mid-hold, or allowed to complete in the background? Current design lets it complete, since the pointer is captured by the button for the duration of a hold.
