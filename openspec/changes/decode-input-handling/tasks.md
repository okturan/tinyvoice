## 1. Camera capture (design D1)

- [ ] 1.1 Hold the camera stream in `useCamera` state and attach it to the video element in an effect keyed on the stream, clearing `srcObject` on cleanup.
- [ ] 1.2 Make `start()` store the stream and then set active, and guard against a second start while a request is in flight.
- [ ] 1.3 Confirm the scanner reaches `HAVE_ENOUGH_DATA` and that a successful scan stops the camera and returns to the Start control.
- [ ] 1.4 Confirm a QR without voice data reports "QR does not contain voice data" and leaves the camera running or stopped per the scanner's existing contract.
- [ ] 1.5 Verify: `decode-sources` "scanning the fake camera feed loads the packet and stops the camera" — remove `test.fail()`.

## 2. One validation path for every input (design D2, D3)

- [ ] 2.1 Add a single `acceptPacket(bytes, source)` in `DecodePanel` that applies the size bound, parses, and reports failure.
- [ ] 2.2 Route the hex, upload, camera and URL paths through it; delete the divergent per-source handling.
- [ ] 2.3 Move `MAX_PACKET_BYTES` enforcement into that shared validation so hex and uploads are bounded like links.
- [ ] 2.4 Adopt the non-destructive failure policy: a failed input reports its error and leaves any loaded packet in place.
- [ ] 2.5 Surface an unreadable URL payload from `QRPage` into the panel's error so a broken share link explains itself.
- [ ] 2.6 Verify: `decode-sources` "?v= with invalid base64…", "…with an odd-length packet…", "…with a single byte…", "a payload over the 64 KiB cap tells the user"; `decode-gaps` "a .bin just over the 64 KiB URL cap is refused", "hex text just over the 64 KiB URL cap is refused" — remove `test.fail()` from each.

## 3. File input handling (design D4)

- [ ] 3.1 Wire `img.onerror` in `Dropzone` to report an unreadable image.
- [ ] 3.2 Revoke the object URL on both the load and error paths.
- [ ] 3.3 Read text-typed files (MIME `text/*`, or `.txt` / `.hex`) as text and parse them with `parseHex`, falling back to the existing invalid-data message when parsing fails.
- [ ] 3.4 Verify: `decode-sources` "an image file that cannot be decoded reports an error"; `decode-gaps` "the file Save hex wrote loads the same packet through Upload" — remove `test.fail()` from each.

## 4. Player controls and progress (design D5–D7)

- [ ] 4.1 Reset `qualityOverride` in `DecodePlayer`'s `[packetBytes]` effect, matching `QRResult`.
- [ ] 4.2 Return early from `handleQualityChange` when the requested decoder is already selected.
- [ ] 4.3 Reset `progress` on decode success and in the catch path; clear the player's download status when the download it started completes.
- [ ] 4.4 Forward `value` to the Radix root in `src/components/ui/progress.tsx` so `aria-valuenow` is set.
- [ ] 4.5 Verify: `decode-cross-quality` "a new packet resets the decoder to Auto", "a new packet whose quality equals the stale override still highlights a decoder"; `decode-gaps` "clicking the decoder that is already selected while playing is a no-op"; `decode-player` "the progress line goes away once the packet has been decoded", "the progress line is cleared after a decode failure", "the decode progress bar exposes its value to assistive technology" — remove `test.fail()` from each.

## 5. Affordances (design D8)

- [ ] 5.1 Add `try/catch` and a transient failure label to `QRResult.copyUrl`, matching `copyHex`.
- [ ] 5.2 Give the settings control in `TopBar` an accessible name.
- [ ] 5.3 Render the navigation entry for the current route as inert, matching the PTT page, so it cannot strip a `?v=` payload.
- [ ] 5.4 Verify: `decode-gaps` "Copy URL reports a clipboard failure without an unhandled rejection", "the gear button can be found as the Settings button", "clicking the already-active QR pill keeps the loaded packet" — remove `test.fail()` from each.

## 6. Test suite reconciliation

- [ ] 6.1 Invert `decode-sources`' "(current behaviour)" tests that pin the destructive failure policy for `.bin` and hex inputs.
- [ ] 6.2 Remove the passing companion that asserts the camera stream never reaches the video element, and the "mounts the viewfinder" caveat comment.
- [ ] 6.3 Invert `decode-gaps`' "(current behaviour)" companions for the gear's empty accessible name, the QR pill wiping the packet, and Copy URL staying silent.
- [ ] 6.4 Update `decode-player` assertions that read the progress indicator's transform style to read its accessible value instead.
- [ ] 6.5 Update `e2e/README.md` where it records the split failure policy and the dead viewfinder as known behaviour.

## 7. Validation

- [ ] 7.1 `npm run typecheck` clean.
- [ ] 7.2 `npm test` clean.
- [ ] 7.3 `npm run test:e2e` — 0 unexpected failures, 0 flaky, and the 18 tests listed in 1.5 / 2.6 / 3.4 / 4.5 / 5.4 no longer carry `test.fail()`.
- [ ] 7.4 Scan a real voice QR with a real camera on a device to confirm the viewfinder and the scan path outside the fake-media harness.
