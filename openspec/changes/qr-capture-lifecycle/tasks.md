## 1. Capture gesture safety (design D4, D5)

- [ ] 1.1 Add `captureGenerationRef` to `useRecordFlow`; have `recDown` capture a generation and `recUp` bump it.
- [ ] 1.2 After each await in `recDown` (`actx.resume`, `audioWorklet.addModule`, `ensureMicStream`), bail when the take is no longer current and tear down whatever that press created.
- [ ] 1.3 Wrap `recDown` in `try/catch`: clear `isRecRef`, tear down partial setup, set a red status naming the failure, return the recorder to idle.
- [ ] 1.4 Guard `recDown` on `recordState === "idle"` and disable `RecordButton` while `recordState !== "idle"`.
- [ ] 1.5 Ensure the recording timer and animation frame installed by an abandoned press are cleared by that press's own teardown.
- [ ] 1.6 Clear `encodeProgress` in `recUp`'s failure path so no progress bar survives a failed encode.
- [ ] 1.7 Verify: `record-flow` "a release that beat the worklet setup leaves no timer running and the next take reports its own length", "pressing HOLD while a recording is being encoded does not start another one"; `record-gaps` "a failed mic re-acquisition is reported in red and the recorder returns to idle", "the codec card's encode progress bar goes away after a failed encode" — remove `test.fail()` from each.

## 2. Truthful record status (design D6, D7)

- [ ] 2.1 Stop `resetResult` from writing a `<quality> loaded` line when that quality is not loaded.
- [ ] 2.2 Reset `statusType` in `handleQualityChange` so informational cache text is not rendered with error emphasis.
- [ ] 2.3 Use `qualityLabel()` instead of the raw enum value in `codec-service.encode()`'s progress status.
- [ ] 2.4 Pass a `disabled` flag from `QualityCard` to `QualityPicker` while the codec state is loading.
- [ ] 2.5 Verify: `record-gaps` "does not claim the deleted quality is still loaded", "an informational cache line written after a red 'Too short' is not red", "the encode step names the quality the way the rest of the card does", "the radios are disabled while the card says Loading models..."; `record-flow` "the encoding status names the quality the way the rest of the app does" — remove `test.fail()` from each.

## 3. Device release (design D3)

- [ ] 3.1 Stop every track on `micRef.current` and close `actxRef.current` in `useRecordFlow`'s unmount cleanup.
- [ ] 3.2 Confirm `ensureMicStream` still re-acquires correctly after a release, and that the audio context is recreated when closed.
- [ ] 3.3 Verify: `layout-persistence` "leaving /qr for PTT releases the microphone", "leaving /qr for PTT closes the recording AudioContext" — remove `test.fail()` from each.

## 4. Session state lifted above the tabs (design D1, D2)

- [ ] 4.1 Add `RecordSessionProvider` that calls `useRecordFlow` once and exposes it; mount it in `QRPage` above `Tabs`.
- [ ] 4.2 Convert `RecordPanel`, `StageSwapRecord` and `SplitDeckRecord` to read the flow from context instead of calling the hook.
- [ ] 4.3 Add `DecodeSessionProvider` holding the parsed packet, its bytes, and the panel error; mount it in `QRPage` above `Tabs`.
- [ ] 4.4 Convert `DecodePanel` to read and write that context; seed it from the URL payload on mount and when the payload changes.
- [ ] 4.5 Keep the decoder override with the packet so it survives a tab round trip.
- [ ] 4.6 Make `Tabs` controlled (`value` / `onValueChange`), selecting Decode whenever a voice payload is present, including on in-app navigation.
- [ ] 4.7 Confirm exactly one live capture track and at most one recording audio context exist after arming, switching ethos, and arming again.
- [ ] 4.8 Verify: `layout-persistence` "a Record result survives an ethos switch", "a Record result survives a Decode round-trip", "a hex-loaded packet survives a Record round-trip", "a ?v= packet keeps its decoder override across a Record round-trip", "switching ethos leaves exactly one live microphone and at most one AudioContext"; `decode-gaps` "pushState to /qr?v= selects the Decode tab" — remove `test.fail()` from each.

## 5. Test suite reconciliation

- [ ] 5.1 Invert the passing tests that pin today's state loss: `record-result` "leaving the Record tab discards the result", and `layout-persistence` / `decode-player` assertions that a hex packet or result is gone after a tab round trip.
- [ ] 5.2 Invert `decode-gaps`'s "(current behaviour)" companion for in-app navigation leaving the Record tab selected.
- [ ] 5.3 Update `decode-player`'s "a URL-loaded packet is re-initialised after a tab round trip" — the decoded buffer and status now survive.
- [ ] 5.4 Update `layout-persistence`'s note that the stage-swap hex form is discarded by "← New source", if lifting the packet changes it.
- [ ] 5.5 Update `e2e/README.md` where it states that inactive tabs unmount and that state is lost.

## 6. Validation

- [ ] 6.1 `npm run typecheck` clean.
- [ ] 6.2 `npm test` clean.
- [ ] 6.3 `npm run test:e2e` — 0 unexpected failures, 0 flaky, and the 17 tests listed in 1.7 / 2.5 / 3.3 / 4.8 no longer carry `test.fail()`.
- [ ] 6.4 Manually confirm in a browser that the recording indicator turns off when navigating from `/qr` to `/`.
- [ ] 6.5 Update `CLAUDE.md`'s known-issues entry about inline logic in the QR page if it no longer applies.
