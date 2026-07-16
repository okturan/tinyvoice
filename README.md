# TinyVoice

TinyVoice is a browser-based push-to-talk and voice-QR experiment built around the [FocalCodec](https://github.com/lucadellalib/focalcodec) neural speech codec. Encoding and decoding run in the browser with ONNX Runtime Web; a Cloudflare Worker relays bounded codec packets between public rooms.

[Live React app](https://tinyvoice.pages.dev/) · [Voice QR](https://tinyvoice.pages.dev/qr) · [Relay health](https://tinyvoice-relay.okan.workers.dev/health)

## What it demonstrates

- Browser-side neural audio inference with a shared WavLM encoder and quality-specific compressor/decoder models
- A compact, versioned binary wire format with legacy packet support
- Shareable voice messages encoded into URLs and QR codes
- Public WebSocket rooms backed by hibernating Cloudflare Durable Objects
- A Durable Object lobby with canonical room identities and stale-room cleanup
- React 19, TypeScript, Vite 7, Tailwind CSS 4, and ONNX Runtime Web
- Runtime-level Worker, WebSocket, hibernation, alarm, parser, and DSP tests

## Architecture

```text
Speaker browser                                  Listener browser
┌────────────────────────┐                       ┌────────────────────────┐
│ microphone             │                       │ codec packet            │
│ WavLM encoder          │                       │ quality decoder         │
│ quality compressor     │── WebSocket relay ──▶│ TypeScript iSTFT       │
│ 16-bit codec tokens    │                       │ Web Audio playback      │
└────────────────────────┘                       └────────────────────────┘
       ONNX Runtime Web                                 ONNX Runtime Web

                       Cloudflare Worker
                  ┌────────────────────────┐
                  │ Room Durable Objects   │
                  │ Lobby Durable Object  │
                  └────────────────────────┘
```

The browser downloads the model artifacts, performs inference, and reconstructs audio. The relay does not run the models and does not decode audio. It handles WebSocket upgrades, bounded display-name control messages, user-list broadcasts, room counts, and binary packet forwarding.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Push-to-talk rooms |
| `/qr` | Record, generate, scan, upload, and decode voice QR messages |
| `/qr.html` | Compatibility redirect to the React QR route |
| Relay `/health` | Health response |
| Relay `/rooms` | Active public-room list |
| Relay `/ws/:room` | WebSocket room upgrade |

## Wire format

```text
[1-byte magic] [N × unsigned 16-bit little-endian tokens]

0x01 = 50 Hz
0x02 = 25 Hz
0x03 = 12.5 Hz
```

The exact packet size is `1 + 2N` bytes, including the magic byte. Packet length therefore depends on the number of codec tokens, which depends on recording duration and token rate. Concrete examples are:

| Tokens | Exact packet bytes |
| ---: | ---: |
| 288 | 577 |
| 144 | 289 |
| 72 | 145 |

These are token-count examples, not fixed sizes for five seconds of audio. At the nominal rates, the payload grows by approximately 100 bytes/s at 50 Hz, 50 bytes/s at 25 Hz, or 25 bytes/s at 12.5 Hz, plus one header byte per packet.

Headerless legacy packets are accepted when they contain a non-empty, even number of bytes. Because duration is variable and quality cannot be inferred reliably from token count, legacy packets use an explicit 50 Hz fallback; they are not described as auto-detected.

The relay accepts codec-shaped binary packets up to 64 KiB. Oversized or malformed packets close the sending connection instead of reaching peers.

## Models and browser storage

Models come from [skymorphosis/focalcodec-onnx](https://huggingface.co/skymorphosis/focalcodec-onnx/tree/a683dc2f143f129c30becb04ffef95cbd52f9eb7) at the immutable revision `a683dc2f143f129c30becb04ffef95cbd52f9eb7`. Downloads are restricted to safe `.onnx` filenames and must match the pinned artifact manifest's exact byte size; truncated, oversized, or mismatched responses are rejected. IndexedDB cache keys include that revision, and the cache schema upgrade clears artifacts stored before the pin.

The size figures below are estimates used by the UI:

| Pipeline | Shared encoder | Compressor | Decoder | Approximate first download |
| --- | ---: | ---: | ---: | ---: |
| 50 Hz | 595 MB | 70 MB | 135 MB | 800 MB |
| 25 Hz | 595 MB | 74 MB | 139 MB | 808 MB |
| 12.5 Hz | 595 MB | 76 MB | 141 MB | 812 MB |

Downloading all three quality pipelines is approximately 1,230 MB by those estimates because the 595 MB encoder is shared. Successful model downloads are cached in IndexedDB on a best-effort basis. Browser storage quotas, private browsing, eviction, or manual clearing can require another download; no fixed cached-load time is promised.

## Public-room and storage boundaries

TinyVoice is an open demonstration, not a private communications product:

- There is no account system, room password, authorization layer, or end-to-end encryption.
- Anyone who knows a valid room identifier can connect, and `/rooms` intentionally lists active room names and connection counts.
- Display names are peer-provided labels, not verified identities.
- Room WebSockets are ephemeral. The lobby persists room counts and timestamps in Durable Object storage so stale entries can be cleaned up; the project therefore does not claim that the relay stores nothing.
- Room identifiers are normalized, bounded, and canonicalized. Display names and their control frames are normalized and bounded. Each room is limited to 64 connections.
- Binary relay payloads are codec-shape checked and limited to 64 KiB, but there is no per-user rate limit.

Do not use the public demo for confidential or safety-critical audio.

## Repository map

```text
src/
├── pages/                 React routes for PTT and QR workflows
├── components/            Room, codec, QR, theme, and UI components
├── contexts/              Codec, room, stats, and theme state
├── hooks/                 Recording, playback, rooms, WebSocket, and camera hooks
├── lib/
│   ├── codec-service.ts   ONNX session orchestration and encode/decode pipeline
│   ├── model-loader.ts    Bounded streaming downloads and IndexedDB integration
│   ├── wire-format.ts     Packet packing, parsing, and token conversion
│   ├── qrParsing.ts       Voice URL/raw-base64 validation
│   └── istft.ts           Inverse FFT and overlap-add reconstruction
└── types/                 Codec and ONNX types

worker/
├── index.ts               Worker plus Room and Lobby Durable Objects
├── wrangler.jsonc         Bindings, migrations, compatibility, and observability
├── tsconfig.json          Strict Worker type-check configuration
└── worker-configuration.d.ts
                           Wrangler-generated runtime and binding types

tests/                     Unit and Cloudflare runtime integration tests
.github/workflows/ci.yml   Least-privilege validation workflow
```

## Local development

Requirements: Node.js 22.12 or newer and npm 11.17.0.

```bash
npm ci --ignore-scripts
npm run dev
```

Run the relay in a second terminal:

```bash
npx wrangler dev --config worker/wrangler.jsonc --port 8787
```

The frontend automatically uses the local relay when its hostname is `localhost`.

## Validation

```bash
npm run audit
npm test
npm run typecheck
npm run build
npm run worker:types:check
npm run worker:dry-run
git diff --check
```

`npm test` runs both pure unit tests and integration tests inside Cloudflare's current Workers test runtime. Coverage includes wire/QR parsing, strict server-message validation, iSTFT invariants, model URL/download edge cases, Worker HTTP routing, Durable Object storage and alarms, byte-exact WebSocket relay behavior, connection cleanup, Unicode room canonicalization, and hibernation recovery.

## Deployment commands

```bash
npm run deploy          # build and deploy the Pages project
npm run deploy:worker   # deploy the Worker
```

Deployment is intentionally separate from CI. Pull requests validate configuration and produce a Worker dry-run bundle but do not deploy or create a release.

## Credits and provenance

- [FocalCodec](https://github.com/lucadellalib/focalcodec) by Luca Della Libera
- [ONNX Runtime Web](https://github.com/microsoft/onnxruntime), loaded from an exact version with Subresource Integrity
- [Cloudflare Workers and Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Meshtastic](https://meshtastic.org/) as the low-bandwidth experimentation inspiration

This repository currently has no project-level `LICENSE` file. Dependency, upstream model, and upstream project licenses remain separate; inspect them before redistribution or commercial use.
