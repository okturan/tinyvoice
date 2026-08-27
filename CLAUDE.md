# TinyVoice — Project Guide

## What this is

Browser-based push-to-talk voice chat + QR voice messages using FocalCodec neural speech codec. All inference runs in-browser via ONNX Runtime WASM. No server-side ML.

## Stack

React 19 + Vite + TypeScript + Tailwind CSS v4 + shadcn/ui. Cloudflare Pages (frontend) + Workers (relay). Models on HuggingFace.

## Project structure

```
src/
  pages/
    PTTPage.tsx         — Main PTT app (ethos-aware: split-deck two-pane, or stage-swap lobby/room "thumb dock")
    QRPage.tsx          — Voice QR tool (controlled tabs; RecordSessionProvider + DecodeSessionProvider sit above the tab boundary)
  components/
    layout/             — TopBar, SettingsSheet, PageShell
    ptt/                — PTTButton, MessageList, ActivityLog, HexDump, WaveformCanvas, ShareModal, StatsStrip, ConnectionPanel
    qr/                 — RecordPanel, DecodePanel, DecodePlayer, QRResult, QualityPicker, Dropzone, CameraScanner, HexSheet
    qr/record/          — StageSwapRecord, SplitDeckRecord + shared pieces (QualityCard, CodecCard, RecordButton, TrimToggle)
    room/               — RoomLobby, RoomActiveCard, RoomInput, RoomList, RoomItem, UserTag
    codec/              — CodecStatus, ModelManagement, ModelLoadingCard
    settings/           — MicSettings (device, gain, live level test)
    theme/              — ThemeSwitcher
    ui/                 — shadcn components + 15 itshover animated icons
  contexts/
    CodecContext.tsx     — Thin React wrapper around codec-service singleton
    RoomContext.tsx      — WebSocket rooms, join/leave, user list
    StatsContext.tsx     — Bytes sent/recv, encode/decode timing
    ThemeContext.tsx     — 6 themes with localStorage persistence
    LayoutContext.tsx    — Layout ethos (stage-swap | split-deck), persisted
    RecordSessionContext.tsx — QR record flow, one useRecordFlow at page scope
    DecodeSessionContext.tsx — QR decode packet, error, decoder override, decoded PCM
  hooks/
    useAudioRecorder.ts — AudioWorklet-based recording
    useRecordFlow.ts    — QR record flow: mic/worklet recording, gain, silence trim, encode
    useAudioPlayer.ts   — AudioContext playback
    useWebSocket.ts     — WebSocket with reconnect
    useRooms.ts         — Room list polling
    useWaveform.ts      — Canvas waveform visualization
    useModelCache.ts    — IndexedDB cache introspection
    useQRScanner.ts     — jsQR camera scanning
    useCamera.ts        — Camera stream management
    useTheme.ts         — Theme read/write
  lib/
    istft.ts            — Cooley-Tukey iFFT + overlap-add (math-critical, invariant-tested)
    model-cache.ts      — IndexedDB CRUD for cached models
    model-loader.ts     — Download with progress + AbortController + cache
    wire-format.ts      — Magic byte pack/unpack
    codec-service.ts    — Unified CodecService singleton (encode/decode/model loading)
    constants.ts        — SR, NFFT, HOP, relay URLs, themes, default rooms (one per quality), quality options
    format.ts           — Byte formatter
    qrParsing.ts        — Base64 voice URL encode/decode
    audio/
      recorder-worklet.ts — AudioWorklet processor (inline Blob URL)
      playback.ts       — AudioContext buffer playback

worker/
  index.ts              — Cloudflare Worker: Room + Lobby Durable Objects
  wrangler.jsonc        — Worker config (name: tinyvoice-relay)
  worker-configuration.d.ts — Wrangler-generated runtime and binding types

public/
  istft_window.json     — Precomputed Hann window (served as static asset)
  _redirects            — SPA routing for Cloudflare Pages

e2e/
  README.md             — Harness guide + page-object cheat-sheet
  vite.e2e.config.ts    — Prod Vite config + alias that shrinks MODEL_ARTIFACT_BYTES to 1 MiB
  support/              — ort-stub.js, model-server.ts, media.ts (fake mic WAV / camera Y4M), app.ts (page object), test.ts (fixtures), packets.ts (independent wire-format oracle)
  specs/                — one spec per QR state area (decode sources/player/cross-quality, record flow/result, models lifecycle, layout & persistence)
```

## Key architecture decisions

- **React + Vite + TypeScript** — ported from vanilla HTML/JS/CSS
- **Unified codec singleton** — `codec-service.ts` shared by PTT (via CodecContext) and QR pages. Promise-based session caching prevents duplicate downloads.
- **Quality enum** — `types/codec.ts` Quality enum ("50hz", "25hz", "12_5hz") used everywhere. Matches ONNX filenames directly.
- **Split encoder model** — shared WavLM encoder.onnx (595MB) + per-quality compressor + decoder
- **iSTFT in TypeScript** — Cooley-Tukey radix-2 iFFT + overlap-add. Math-critical, do not modify.
- **Magic byte wire format** — 0x01=50hz, 0x02=25hz, 0x03=12.5hz
- **One-hour room history** — the Room DO persists every relayed packet in SQLite (`message_history`) and replays the backlog to each socket that sends `hello {history:true}`, once per socket. Retention is 1h / 1000 messages, pruned on write and by an alarm set to the oldest entry's expiry. History frames use a distinct marker: `[0xFD][sentAt f64 BE][nameLen][name][packet]`. A room's quality lock now survives an empty room while history remains, so replayed packets stay decodable.
- **Room quality lock** — a room's first participant locks its quality (hello message or first packet's magic byte; stored in the Room DO, cleared when the room empties). The relay rejects mismatched packets with a `{type:"error"}` control message and wraps relayed packets with the sender name: `[0xFE][nameLen][name utf8][packet]`. `0xFE` is reserved on the wire — the relay refuses client packets starting with it, so the wrap marker is unambiguous.
- **IndexedDB caching** — models cached after first download ('focalcodec-models' store)
- **AudioWorklet** — replaced deprecated ScriptProcessorNode for recording
- **ORT via CDN** — loaded from `<script>` tag in index.html, accessed as `window.ort`
- **6 themes** — CSS custom properties: --base, --mantle, --surface0, --text, --tv-accent, --green, --red, etc.
- **Client-side QR** — `qrcode` npm package replaces old api.qrserver.com dependency

## Deployment

```bash
npm run deploy          # build + strip ONNX + deploy to Cloudflare Pages
npm run deploy:worker   # deploy worker to Cloudflare Workers
npm run dev             # local dev server
```

- Frontend: https://tinyvoice.pages.dev
- Relay: https://tinyvoice-relay.okan.workers.dev
- Models: HuggingFace (skymorphosis/focalcodec-onnx)

## Testing locally

```bash
npm run dev              # Vite dev server (frontend)
npx wrangler dev --config worker/wrangler.jsonc --port 8787
npm test                 # unit + Cloudflare runtime integration tests
npm run test:e2e         # Playwright browser suite for the QR page (see e2e/README.md)
```

The e2e suite runs the real app in Chromium against a stubbed `window.ort`, a fake HuggingFace
model server (1 MiB self-describing bodies), and Chromium's fake mic/camera. Tests marked
`test.fail()` with a `// BUG:` comment document known defects and flip to "unexpected pass" once
fixed — remove the annotation when you fix the bug.

## Known issues / tech debt

- **PTTPage still has some inline logic** that should move into contexts/hooks.
- Float16 ONNX models failed ORT validation — only float32 works
- Encoder ONNX export requires legacy tracer (dynamo=False) due to WavLM attention layer
- Chunk size warning on build (580KB JS) — motion library is large, could code-split

## GitHub

- Repo: https://github.com/okturan/tinyvoice
