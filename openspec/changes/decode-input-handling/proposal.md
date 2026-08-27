## Why

The camera source cannot scan anything: the stream is assigned to a `<video>` that has not mounted yet, so the viewfinder is permanently black and no QR is ever read. Around it sits a group of input and feedback defects found by the `/qr` audit — a broken share link opens an empty tab with no explanation, an undecodable image does nothing at all, the 64 KiB limit that guards shared links is absent from the hex and upload paths, and the app's own "Save hex" file is rejected by its own uploader. Eighteen Playwright tests already assert the corrected behaviour.

## What Changes

- The camera viewfinder receives its stream, so scanning works: pointing the camera at a voice QR loads the packet and stops the camera.
- Every way a packet can arrive is validated the same way and reports the same kinds of failure: an unreadable share link, a file that is not a packet, an image that cannot be decoded, and an image with no QR each produce a visible message instead of silence.
- The size limit that protects the shared-link path applies to pasted hex and uploaded files too, so an oversized payload is refused rather than rendering one element per byte.
- A file written by the app's own "Save hex" action loads through the Upload source.
- A failed load no longer destroys the packet the user already had — one policy replaces today's split, where a bad file cleared the player but a bad QR image did not.
- The decoder selection is a property of the packet being played: it resets when a new packet is loaded, and re-choosing the decoder that is already active does nothing rather than stopping playback and discarding the decoded audio.
- Progress indicators disappear when there is no longer any progress to report, and report their value to assistive technology instead of appearing indeterminate.
- Clipboard actions report failure, the settings control has an accessible name, and the navigation pill for the page you are already on does not discard a loaded packet.

## Capabilities

### New Capabilities
- `voice-packet-input`: how voice packets arrive from a link, pasted hex, an uploaded file or the camera; how each input is validated and bounded; and how failures are reported.
- `decode-playback-controls`: the decode player's decoder selection and its progress and status feedback.
- `qr-page-affordances`: feedback for share actions, accessible naming of page controls, and navigation that preserves a loaded packet.

### Modified Capabilities
<!-- None: these are the first specs covering the QR page's input and playback controls. -->

## Impact

- **Code**: `src/hooks/useCamera.ts` (stream attachment), `src/components/qr/CameraScanner.tsx`, `src/components/qr/Dropzone.tsx` (image error handling, object URL cleanup, hex text files), `src/components/qr/DecodePanel.tsx` (one validation entry point, one failure policy), `src/pages/QRPage.tsx` (surfacing an unreadable payload), `src/lib/qrParsing.ts` (size limit shared across inputs), `src/components/qr/DecodePlayer.tsx` (override reset, no-op guard, progress reset), `src/components/ui/progress.tsx` (accessible value), `src/components/qr/QRResult.tsx` (clipboard failure), `src/components/layout/TopBar.tsx` (accessible name, inert active pill).
- **Independent**: does not depend on `codec-model-lifecycle` or `qr-capture-lifecycle` and can land before either. It touches `DecodePlayer` and `DecodePanel`, which `qr-capture-lifecycle` also restructures, so whichever lands second rebases.
- **Tests**: 18 `test.fail()` tests flip to passing and lose their annotations, across `decode-sources`, `decode-gaps`, `decode-player` and `decode-cross-quality`. Passing tests that pin the current split failure policy and the empty viewfinder with `// NOTE:` comments are inverted in the same change.
- **No change**: the wire format itself, the codec, model loading, or the relay.
