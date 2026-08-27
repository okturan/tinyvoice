# TinyVoice end-to-end suite

Playwright drives the real React app in Chromium against a stubbed neural
runtime, so every UI state of the QR page can be exercised in seconds and
without a 1.2 GB model download.

```bash
npm run test:e2e            # headless; builds the app and serves it with `vite preview` on :5174
npm run test:e2e:ui         # Playwright UI mode
npm run dev:e2e             # a dev server with the e2e aliases — Playwright reuses it if it is up
npx playwright test e2e/specs/decode-cross-quality.spec.ts   # one file
npx playwright show-trace e2e/.results/<test>/trace.zip       # inspect a failure
```

The suite targets a production build (no HMR or dependency re-optimisation reloads mid-test).
When you change app code, restart the run so it rebuilds, or keep `npm run dev:e2e` running for
instant reloads while iterating.

## What is real and what is faked

| Layer | In the suite |
|---|---|
| React app, router, contexts, hooks, IndexedDB model cache, wire format, base64/QR parsing, iSTFT | **real** (served by `e2e/vite.e2e.config.ts`) |
| `@/lib/constants` | real, except `MODEL_ARTIFACT_BYTES` is 1 MiB per model (`e2e/fixtures/constants.e2e.ts`) so the real `model-loader` accepts the fake bodies |
| HuggingFace model downloads | `e2e/support/model-server.ts` — every `*.onnx` is a 1 MiB body whose first bytes spell the filename; per-model `delayMs` / `status` / `hang` |
| `window.ort` (onnxruntime-web CDN script) | `e2e/support/ort-stub.js`, injected before the page boots. Encoder → frame count, compressor → `round(frames × rate / 50)` deterministic tokens, decoder → `round(tokens × 50 / rate)` frames of a 440 Hz partial. So **decoding with the wrong-rate decoder changes the duration** exactly like the real codec would (a 2 s 50 hz packet decoded at 12.5 hz plays for 8 s). |
| Microphone | Chromium `--use-file-for-fake-audio-capture` playing `e2e/.generated/mic.wav` (gated 440 Hz tone) |
| Camera | Chromium `--use-file-for-fake-video-capture` playing `e2e/.generated/camera.y4m` — one large QR encoding `CAMERA_PACKET` (`e2e/support/media.ts`) |
| Everything else on the network | aborted (`test.ts`), except `localhost:8787/rooms` which returns `[]` |

`e2e/support/global-setup.ts` regenerates the media files atomically before each run.

## Fixtures (`e2e/support/test.ts`)

```ts
import { test, expect } from "../support/test";

test("…", async ({ app, models, page, pageErrors }) => { … });
```

* `app` — page object (`e2e/support/app.ts`), see below.
* `models` — `ModelServer`: `models.requests` (names in order), `models.requestsFor(name)`,
  `models.set("decoder_25hz.onnx" | "*", { delayMs, status, hang })`, `models.release()`, `models.hungCount`, `models.reset()`.
* `pageErrors` — uncaught page exceptions; the test fails at teardown if any occurred unless `test.use({ strictPageErrors: false })`.

## Page object cheat-sheet (`app`)

Navigation: `goto({ v?, tab? })`, `presetEthos("stage-swap" | "split-deck")` (call **before** `goto`), `openTab("record" | "decode")`, `tab(name)`.

Decode sources: `openSource("hex" | "upload" | "camera")`, `submitHex(text)`, `hexTextarea`, `decodeHexButton`, `editHexButton`, `uploadFile(name, bytes, mime)`, `startCameraButton`, `stopCameraButton`, `sourceError` (panel-level red line), `hexInlineError` (HexInput's `role=alert`).

Player: `playerCard`, `playButton` (aria-label `Play voice packet` / `Stop voice playback` / `Decoding voice packet`), `downloadModelsButton` (`Download 12.5hz models` / `Loading models...`), `playerStatus`, `playerHexButton`, `newSourceButton` (stage-swap only), `playerPlaceholder` (split-deck only).

Decoder row (both tabs): `decoderRow`, `decoderButtons()`, `decoderButton(label)`, `decoderLabels()`, `selectedDecoderLabels()`, `expectDecoderSelected(label)`.

Record: `qualityRadio(q)`, `qualityOption(q)` (the clickable label — the radio is sr-only), `pickQuality(q)`, `codecCard`, `codecButton` (`Choose models` / `Load cached models` / `Loading models...` / `Enable microphone`), `codecCancelButton`, `codecStatus`, `holdButton` (`HOLD` / `ENCODING`), `recordingTimer`, `trimSwitch`, `hold(ms)`, `record(ms)`.

Result: `qrImage`, `previewButton` (`Preview` / `Playing...` / `Loading...`), `copyUrlButton`, `copyHexButton`, `saveHexButton`, `downloadQrButton`, `resultHexButton`, `newRecordingButton`, `resultPlaceholder`, `resultBlock`, `resultMeta()`, `resultUrl()`.

Settings / models: `openSettings("General" | "Audio" | "Models")`, `closeSettings()`, `settingsCodecButton`, `settingsCodecStatus`, `downloadDialog`, `dialogRow(q)`, `selectMultiple(qualities)`, `startDialogDownload(qualities)`, `loadModelsViaSettings(qualities)`, `deleteModelsViaSettings()`, `switchEthosViaSettings(ethos)`.

Runtime stub: `setOrt({ delayMs, createDelayMs, failRun, failCreate, failMessage })`, `ortState()` → `{ sessions, runs }`, `localStorageItem(key)`.

Packets (`e2e/support/packets.ts`, an independent oracle — do not import the app's wire-format): `packet(q, tokens)`, `packetSeconds(q, seconds, seed)`, `legacyPacket(tokens)`, `toBase64`, `toHex`, `voiceUrl(origin, bytes)`, `initialStatus(bytes, q, legacy?)`, `RATE`, `LABEL`, `ALL_QUALITIES`.

## Conventions

* Tests are independent: fresh browser context, empty IndexedDB, nothing loaded. Load models through the UI (`loadModelsViaSettings`, the record tab's `codecButton`, or the player's `downloadModelsButton`).
* Assert on what a user sees (roles, labels, status text). No test ids in app code.
* A confirmed app bug gets a test that asserts the **correct** behaviour and is marked `test.fail()` with a `// BUG:` comment (what happens, where in the code). It flips to "unexpected pass" once fixed.
* Decode inputs share one size bound and one failure policy: a failed load reports an error and leaves any already-loaded packet in place. The camera viewfinder receives the live stream, so a voice QR in the fake camera feed loads the packet and stops the camera.

## Gotchas the first authors hit

* **URLs over 16 KB** — the dev/preview server answers HTTP 431 for request lines that long, so a `?v=` payload near the 64 KiB cap cannot be navigated to directly; push it with `history.pushState` + a `PopStateEvent` (see `gotoViaHistory` in `decode-sources.spec.ts`).
* **Modal dialogs aria-hide the rest** — while the download dialog is open, `app.settingsSheet` (a `role=dialog` query) resolves to nothing; press Escape on the dialog before asserting on the sheet.
* **Transient strings** — "Downloading <q> models..." in the player and "Encoding (12_5hz)..." on the record card last one render or less; hold the state open with `models.set("*", { hang: true })` / `delayMs`, or `app.setOrt({ delayMs })`, before asserting.
* **`test.fail()` traces are not retained** — to see where an expected-failure test actually fails, run a temporary copy with the annotation removed.
* **Radix `data-state`** is an implementation detail; prefer `aria-selected` for tabs and `aria-checked` for the quality radios.
* **Playback ends on its own** — anything that must click Stop mid-playback should load a long packet (`packetSeconds(q, 30)`), not a 1 s one.
