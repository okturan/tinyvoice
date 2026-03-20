# TinyVoice — Project Guide

## What this is

Browser-based push-to-talk voice chat + QR voice messages using FocalCodec neural speech codec. All inference runs in-browser via ONNX Runtime WASM. No server-side ML.

## Stack

React 19 + Vite + TypeScript + Tailwind CSS v4 + shadcn/ui. Cloudflare Pages (frontend) + Workers (relay). Models on HuggingFace.

## Project structure

```
src/
  pages/
    PTTPage.tsx         — Main PTT app (two-pane: sidebar + main)
    QRPage.tsx          — Voice QR tool (tabs: Record / Decode)
  components/
    layout/             — TopBar, SettingsSheet, PageShell
    ptt/                — PTTButton, ActivityLog, HexDump, WaveformCanvas, ShareModal, StatsStrip, ConnectionPanel
    qr/                 — RecordPanel, DecodePanel, DecodePlayer, QRResult, QualityPicker, Dropzone, CameraScanner, HexSheet
    room/               — RoomLobby, RoomActiveCard, RoomInput, RoomList, RoomItem, UserTag
    codec/              — CodecStatus, ModelManagement, ModelLoadingCard
    theme/              — ThemeSwitcher
    ui/                 — shadcn components + 15 itshover animated icons
  contexts/
    CodecContext.tsx     — ONNX model loading, encode/decode for PTT page
    RoomContext.tsx      — WebSocket rooms, join/leave, user list
    StatsContext.tsx     — Bytes sent/recv, encode/decode timing
    ThemeContext.tsx     — 6 themes with localStorage persistence
  hooks/
    useAudioRecorder.ts — AudioWorklet-based recording
    useAudioPlayer.ts   — AudioContext playback
    useWebSocket.ts     — WebSocket with reconnect
    useRooms.ts         — Room list polling
    useWaveform.ts      — Canvas waveform visualization
    useModelCache.ts    — IndexedDB cache introspection
    useQRScanner.ts     — jsQR camera scanning
    useCamera.ts        — Camera stream management
    useTheme.ts         — Theme read/write
  lib/
    istft.ts            — Cooley-Tukey iFFT + overlap-add (math-critical, verified)
    model-cache.ts      — IndexedDB CRUD for cached models
    model-loader.ts     — Download with progress + AbortController + cache
    wire-format.ts      — Magic byte pack/unpack
    codec.ts            — QR page's standalone codec (NEEDS UNIFICATION with CodecContext)
    constants.ts        — SR, NFFT, HOP, relay URLs, themes, room names, quality types
    config.ts           — Relay server URLs
    format.ts           — Byte formatter
    names.ts            — Random name generators
    qrParsing.ts        — Base64 voice URL encode/decode
    audio/
      recorder-worklet.ts — AudioWorklet processor (inline Blob URL)
      playback.ts       — AudioContext buffer playback

worker/
  index.js              — Cloudflare Worker: Room + Lobby Durable Objects
  wrangler.toml         — Worker config (name: tinyvoice-relay)

public/
  index.html            — Old vanilla PTT app (legacy, not used by React build)
  qr.html               — Old vanilla QR app (legacy, not used by React build)
  istft_window.json     — Precomputed Hann window (served as static asset)
  _redirects            — SPA routing for Cloudflare Pages
```

## Key architecture decisions

- **React + Vite + TypeScript** — ported from vanilla HTML/JS/CSS
- **Split encoder model** — shared WavLM encoder.onnx (595MB) + per-quality compressor + decoder
- **iSTFT in TypeScript** — Cooley-Tukey radix-2 iFFT + overlap-add. Math-critical, do not modify.
- **Magic byte wire format** — 0x01=50hz, 0x02=25hz, 0x03=12.5hz
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
cd worker && wrangler dev --port 8787   # Worker dev server
```

## Known issues / tech debt

### Critical — needs unification refactor
- **Two separate codec systems**: `CodecContext.tsx` (PTT page) and `src/lib/codec.ts` (QR page) are independent implementations with different APIs, different model loading, different progress tracking. They should be unified into one clean system.
- **Two model cache modules existed** — `modelCache.ts` was deleted and imports redirected to `model-cache.ts`, but `codec.ts` still has its own `loadModel` adapter function wrapping `model-cache.ts`.
- **PTTPage still has some inline logic** that should move into contexts/hooks.

### Other
- Float16 ONNX models failed ORT validation — only float32 works
- Encoder ONNX export requires legacy tracer (dynamo=False) due to WavLM attention layer
- Old vanilla HTML files still in `public/` (index.html, qr.html, app.css, etc.) — not used by React build but get copied to dist. Deploy script strips them.
- `src/lib/rooms.ts` and `src/lib/utils/names.ts` are duplicate/unused files from the port
- Chunk size warning on build (580KB JS) — motion library is large, could code-split

## GitHub

- Repo: https://github.com/okturan/tinyvoice
