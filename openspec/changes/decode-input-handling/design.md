## Context

`useCamera.start()` assigns `videoRef.current.srcObject = stream` and *then* calls `setIsActive(true)`, but `CameraScanner` renders its `<video>` only while `isActive` is true. At assignment time the ref is null, nothing re-attaches after the element mounts, and `useQRScanner` bails on `readyState !== HAVE_ENOUGH_DATA` on every tick. The viewfinder is black and the feature has never worked in production.

The rest of this change is a set of small, independent input and feedback defects that share one theme: each input path in `DecodePanel` was written separately. `handleTokenData`, `handleHexData` and `handleQRData` validate differently and disagree about what a failure does to the packet already loaded — the first two null out `parsed`/`packetBytes` (unmounting the player and discarding its decoded buffer), while the third only sets an error string. The 64 KiB bound lives in `decodePacketBase64`, so it guards shared links but not hex or uploads. `Dropzone` wires `img.onload` but not `img.onerror`, and never revokes the object URL. `QRPage` computes `initialData` and silently drops a null.

In the player, the `[packetBytes]` effect resets everything except `qualityOverride` — `QRResult` resets its equivalent, so `DecodePlayer` is the inconsistent one — and `handleQualityChange` has no early return for the already-selected value, so a no-op tap stops playback and drops the decoded buffer. `progress` is never reset on success or failure, so the bar sticks at 100% or 80%. The shadcn `Progress` wrapper destructures `value` out of the props and only uses it for the indicator's transform, so the Radix root never receives it and every progress bar in the app is announced as indeterminate.

## Goals / Non-Goals

**Goals:**
- Make the camera source work.
- Give every input path one validation entry point, one size bound, and one failure policy.
- Make the decoder selection a property of the packet, and make no-op selections free.
- Make progress and status honest, and expose progress to assistive technology.

**Non-Goals:**
- Changing the wire format or how packets are parsed into tokens.
- Reworking the Decode panel's layout or its source sub-tabs.
- Model loading semantics (`codec-model-lifecycle`) or session persistence (`qr-capture-lifecycle`).
- Supporting new input types beyond what exists, other than accepting the app's own hex export.

## Decisions

### D1 — Attach the camera stream in an effect

`useCamera` keeps the stream in state rather than assigning it inside `start()`, and an effect attaches it once the element exists:

```
useEffect(() => {
  const el = videoRef.current;
  if (!el || !stream) return;
  el.srcObject = stream;
  return () => { el.srcObject = null; };
}, [stream]);
```

`start()` becomes: request the stream, store it, set active. The ordering hazard disappears because attachment is driven by the element's existence, not by the call site's timing.

*Alternative considered.* Keeping `<video>` mounted permanently and hiding it with CSS. Rejected — it keeps a media element alive for users who never open the camera, and the effect is simpler.

*Also fixed here.* `start()` guards against a second invocation while a request is already in flight, so a double click cannot orphan the first stream in `streamRef`.

### D2 — One validation entry point in `DecodePanel`

All four sources converge on a single `acceptPacket(bytes, source)` that applies the size bound, parses, and on failure reports the message without touching the loaded packet. `handleQRData` decodes the QR string to bytes and then calls the same function, so QR-sourced input is bounded like every other path.

The failure policy is unified to the **less destructive** of the two that exist today: a failed input never unloads the packet the user already has. That is the behaviour the QR path already had, and it is the one that cannot lose a decoded buffer.

### D3 — The size bound moves to the validator

`MAX_PACKET_BYTES` moves out of `decodePacketBase64` into the shared validation used by every path (`qrParsing` keeps applying it for links, which is now the same code). An oversized payload produces the same message wherever it came from.

### D4 — Hex text files are recognised on upload

`Dropzone` currently treats every non-image file as raw bytes, which is why the app's own `tinyvoice-<N>B.hex.txt` is rejected. Files with a text MIME type (or a `.txt`/`.hex` extension) are read as text and parsed with the existing `parseHex`; anything else keeps the raw-bytes path. `img.onerror` is wired to report an unreadable image, and both the load and error paths revoke the object URL.

### D5 — The decoder override resets with the packet

`setQualityOverride(null)` joins the `[packetBytes]` effect, matching `QRResult`. That alone fixes both override defects: the stale decoder cannot be applied to a new packet, and the "no button highlighted" case cannot arise because the override can no longer equal the new packet's own quality.

`handleQualityChange` returns early when the requested value equals the current selection, so a no-op tap does not bump the playback generation or discard the buffer.

### D6 — Progress is reset where it is set

`handlePlay` clears `progress` on success and in its catch; the same applies to the model-download path so the bar does not survive its work. The player's status is cleared when a download it started completes, so it stops claiming to be downloading.

### D7 — `Progress` forwards its value

The wrapper passes `value` through to the Radix root instead of consuming it, so `aria-valuenow` and `data-state` are correct. This is a one-line fix in a shared UI component and improves every progress bar in the app, including PTT's.

### D8 — Affordance fixes

`copyUrl` gains the `try/catch` and transient failure label that `copyHex` already has. The settings control gets an accessible name. The navigation entry for the current route renders inert — matching what the PTT page already does — so activating it cannot strip a `?v=` payload.

## Risks / Trade-offs

- **Changing the failure policy alters behaviour users may rely on** → Two tests currently pin the destructive policy for files and hex. The unified policy is strictly less destructive: no input can now discard a packet or its decoded audio. Tests are inverted in this change.
- **The camera fix opens paths that have never run in production** → Scanning, the stop-on-scan transition, and the "QR without voice data" message are all reachable for the first time. Each has a scenario and an e2e test against the fake camera feed.
- **Accepting text files on upload could misread a binary file with a text MIME type** → Detection is by MIME type and extension, and a file that fails hex parsing falls back to the existing "not voice data" message rather than being silently mangled.
- **This change and `qr-capture-lifecycle` both edit `DecodePanel` and `DecodePlayer`** → Different regions (validation and player controls here; state lifting there). Whichever lands second rebases.
- **Forwarding `value` to the Radix progress root changes rendered attributes app-wide** → Purely additive for sighted users; a few e2e assertions read the indicator transform and are updated to read the accessible value instead.

## Migration Plan

No data or storage changes. All fixes are local to component and hook behaviour.

Suggested order:

1. Camera attachment (D1) — self-contained, unblocks a whole feature.
2. Input validation, bounds, hex files, image errors (D2–D4) — the `DecodePanel` and `Dropzone` group, landing with the failure-policy test inversions.
3. Player controls and progress (D5–D7).
4. Affordances (D8).

Each step is independently revertible.

## Open Questions

- Should an oversized or unreadable payload in a shared link also clear the `?v=` parameter, so a reload does not reproduce the same failure? Current design reports the error and leaves the URL alone.
- Should the hex export be given its own file extension or a header line, so the uploader can recognise it without sniffing? Current design sniffs MIME type and extension.
