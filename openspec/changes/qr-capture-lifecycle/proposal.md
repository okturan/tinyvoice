## Why

A finished recording on `/qr` is destroyed by a tab click or a layout change, and neither unmount releases the microphone — the capture track stays live, the AudioContext stays open, and re-arming opens a second of each. The record gesture itself has no fence around its asynchronous setup, so a fast release orphans a worklet that silently doubles the next take, a press during encoding starts a concurrent capture, and a microphone that fails to re-acquire is reported as "Too short — hold longer". Ten defects from the `/qr` audit trace to these two problems, each with a Playwright test that already asserts the corrected behaviour.

## What Changes

- Session state on `/qr` moves above the tab and layout boundaries, so a recording, its QR result, the armed microphone, and a loaded decode packet all survive switching tabs and switching layout ethos. Today each of those lives inside a component React unmounts.
- The Record and Decode tabs become a controlled selection, so arriving at a voice URL through in-app navigation opens the Decode tab rather than leaving the packet behind the Record tab.
- Leaving `/qr` stops the capture track and closes the recording AudioContext. At most one live capture track and one recording AudioContext may exist at a time, whatever the user has switched between.
- The record gesture is fenced against its own asynchronous setup: a release that lands before the worklet, microphone and audio context are wired tears that setup down instead of orphaning it, and the recorder cannot be started again while a take is still encoding.
- Microphone acquisition failures during a hold are reported as microphone errors and return the recorder to idle, instead of surfacing as an uncaught error and a misleading "too short" message.
- Status text on the record surface stops making claims that are not true: no "loaded" line for models that were deleted, no informational message inheriting the red of a previous error, and the quality named during encoding matches the label used everywhere else.
- The quality picker is disabled while a model load is running, so a load can no longer complete against a quality the user has since changed.

## Capabilities

### New Capabilities
- `qr-session-state`: what the `/qr` page retains across tab switches, layout changes, navigation and reload, and when capture devices are released.
- `voice-capture`: the press-to-record gesture's state machine — its guards, its failure handling, and the truthfulness of the status it reports.

### Modified Capabilities
<!-- None: these are the first specs covering the QR page's session and capture behaviour. -->

## Impact

- **Code**: `src/pages/QRPage.tsx` (session providers above the tabs, controlled tab selection), `src/components/qr/RecordPanel.tsx` and both layout variants (`StageSwapRecord`, `SplitDeckRecord`) which currently each instantiate the flow, `src/hooks/useRecordFlow.ts` (gesture fencing, teardown, status), `src/components/qr/DecodePanel.tsx` (packet state lifted), `src/components/qr/record/RecordButton.tsx` (disabled while not idle), `src/components/qr/record/QualityCard.tsx` (disabled while loading), `src/lib/codec-service.ts` (encode status label).
- **Behaviour**: the microphone stays armed while the user is on the Decode tab, which is a change from today's implicit release-by-unmount. It is released when the user leaves `/qr`.
- **Depends on**: nothing in `codec-model-lifecycle`; the two changes touch different concerns and can land in either order. Both edit `useRecordFlow`, so whichever lands second rebases.
- **Tests**: 17 `test.fail()` tests flip to passing and lose their annotations — all of `layout-persistence`'s persistence and device-leak group, `record-flow`'s gesture and encode-label cases, all of `record-gaps`, and `decode-gaps`'s controlled-tab case. Passing tests that pin today's state loss with `// NOTE:` comments are inverted in the same change.
- **No change**: the wire format, the codec service's inference paths, the relay, and PTT.
