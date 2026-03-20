# TinyVoice — Project Guide

## What this is

Browser-based push-to-talk voice chat + QR voice messages using FocalCodec neural speech codec. All inference runs in-browser via ONNX Runtime WASM. No server-side ML.

## Project structure

```
public/
  index.html      — Main PTT app (rooms, WebSocket, encode/decode, ~700 lines)
  qr.html         — Voice QR tool (record → QR, scan/drop → decode, ~900 lines)
  app.css         — Layout, components, responsive styles
  themes.css      — 6 color themes (Mocha, Nord, Rose Pine, Solarized, Midnight, Latte)
  shared.js       — IndexedDB cache, iSTFT (inverse FFT), constants, utilities
  istft_window.json — Precomputed Hann window coefficients for iSTFT synthesis

worker/
  index.js        — Cloudflare Worker: Room + Lobby Durable Objects (WebSocket relay)
  wrangler.toml   — Worker config, DO bindings, migrations
```

## Key architecture decisions

- **No build step** — vanilla HTML/JS/CSS, zero dependencies beyond ONNX Runtime Web and jsQR
- **Split encoder model** — shared WavLM encoder.onnx (595MB) + per-quality compressor + decoder. Saves ~600MB when using multiple quality levels.
- **iSTFT in JavaScript** — ONNX can't export PyTorch's inverse FFT, so we implement Cooley-Tukey radix-2 iFFT + overlap-add in JS (shared.js). This is the mathematically critical code — reviewed and verified correct.
- **Magic byte wire format** — first byte of every voice packet indicates codec quality (0x01=50hz, 0x02=25hz, 0x03=12.5hz). Enables auto-detection on decode.
- **IndexedDB caching** — models cached after first download. Both pages share the same IndexedDB ('focalcodec-models'). Check cache before downloading.

## Deployment

```bash
# Deploy frontend (exclude .onnx files — they're on HuggingFace)
wrangler pages deploy public --project-name focalcodec-walkie

# Deploy worker
cd worker && wrangler deploy
```

- Frontend: Cloudflare Pages (focalcodec-walkie.pages.dev)
- Relay: Cloudflare Workers (focalcodec-relay.okan.workers.dev)
- Models: HuggingFace (skymorphosis/focalcodec-onnx)

## ONNX models on HuggingFace

| File | Size | Shared? |
|------|------|---------|
| encoder.onnx | 595 MB | Yes — one for all qualities |
| compressor_50hz.onnx | 70 MB | Per quality |
| compressor_25hz.onnx | 74 MB | Per quality |
| compressor_12_5hz.onnx | 76 MB | Per quality |
| decoder_50hz.onnx | 135 MB | Per quality |
| decoder_25hz.onnx | 139 MB | Per quality |
| decoder_12_5hz.onnx | 141 MB | Per quality |

## Common tasks

### Adding a new feature to both pages
Both index.html and qr.html have duplicated code (iSTFT, IndexedDB, etc.). shared.js was created to deduplicate — index.html uses it, qr.html still has inline copies. When modifying shared logic, update shared.js and ensure both pages work.

### Changing themes
Edit themes.css. Each theme defines CSS custom properties (--base, --mantle, --surface0, --text, --accent, --green, --red, etc.). Components use these variables exclusively — no hardcoded colors in app.css.

### Deploying
ONNX files in public/ are gitignored and not deployed to Cloudflare Pages (25MB limit). Move them to /tmp before deploying, move back after:
```bash
mkdir -p /tmp/onnx-backup && mv public/*.onnx /tmp/onnx-backup/
wrangler pages deploy public --project-name focalcodec-walkie
mv /tmp/onnx-backup/*.onnx public/
```

### Testing locally
```bash
cd public && python3 -m http.server 8787
cd worker && wrangler dev --port 8788
```

## Known issues / tech debt

- qr.html still has inline iSTFT + IndexedDB instead of using shared.js
- ScriptProcessorNode is deprecated (works but should migrate to AudioWorklet)
- Lobby room counts can go stale on Worker cold starts
- QR generation depends on third-party api.qrserver.com (no error handling)
- Float16 ONNX models failed ORT validation — only float32 works
- Encoder ONNX export requires legacy tracer (dynamo=False) due to WavLM attention layer
- Planned: port to React/shadcn for proper component architecture

## GitHub

- Repo: https://github.com/okturan/tinyvoice
- Meshtastic PR (separate project): https://github.com/meshtastic/firmware/pull/9953
