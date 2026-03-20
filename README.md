# TinyVoice

Voice chat over 576 bytes. A push-to-talk app that compresses speech into tiny packets using a neural speech codec running entirely in your browser via WebAssembly. Also generates scannable QR codes from voice messages.

**[Live demo](https://focalcodec-walkie.pages.dev)** · **[Voice QR tool](https://focalcodec-walkie.pages.dev/qr.html)**

## How it works

```
Speaker's browser                          Listener's browser
┌──────────────────────┐                   ┌──────────────────────┐
│ Mic → WavLM Encoder  │                   │  Vocos Decoder       │
│    → Compressor      │  ── 577 bytes ──▸ │    → iSTFT (JS)      │
│    → Quantizer       │   (WebSocket)     │    → Speaker         │
└──────────────────────┘                   └──────────────────────┘
      ONNX Runtime (WASM)                       ONNX Runtime (WASM)
```

1. **Record** — hold the PTT button, speak
2. **Encode** — shared WavLM encoder (88.7M params) + quality-specific compressor runs in WASM
3. **Transmit** — magic byte + token data sent via WebSocket relay
4. **Decode** — matching decoder + iSTFT (pure JavaScript) reconstructs audio
5. **Play** — decoded audio plays instantly

All neural network inference happens in the browser. The relay server only forwards raw bytes.

## Pages

| Page | Purpose |
|------|---------|
| `/` | PTT rooms — join a room, push-to-talk, hear others |
| `/qr.html` | Voice QR — record, encode, generate QR code, decode from scan/drop |

## Quality levels

| Config | Rate | Bytes/5s | QR size | Use case |
|--------|------|----------|---------|----------|
| 50hz | 50 tok/s | 577 | Large | Best quality (PTT default) |
| 25hz | 25 tok/s | 289 | Medium | Balanced |
| 12.5hz | 12.5 tok/s | 145 | Tiny | QR codes, minimal bandwidth |

## Wire format

```
[1 byte magic] [N × 2 bytes tokens (16-bit LE)]

Magic: 0x01 = 50hz, 0x02 = 25hz, 0x03 = 12.5hz
```

Legacy links without a magic byte are supported — the decoder guesses quality from token count.

## Architecture

### Split encoder model

The WavLM encoder (88.7M params, 595MB) is **shared** across all quality levels. Only the compressor and decoder differ per quality (~70-76MB + ~135-141MB each). This means:

- First quality download: ~800MB (encoder + one comp/dec pair)
- Each additional quality: ~210MB
- All three: ~1.2GB total

Models are cached in **IndexedDB** — subsequent visits load from local storage in 1-2 seconds.

### Files

```
public/
├── index.html         Main PTT app (rooms, WebSocket, encode/decode)
├── qr.html            Voice QR tool (record → QR, scan → decode)
├── app.css            Layout and components
├── themes.css         6 color themes
├── shared.js          IndexedDB cache, iSTFT, utilities
└── istft_window.json  Precomputed window for iSTFT synthesis

worker/
├── index.js           Cloudflare Worker (Room + Lobby Durable Objects)
└── wrangler.toml      Worker config and DO migrations
```

### Services

| Service | URL |
|---------|-----|
| Frontend | Cloudflare Pages |
| Relay | Cloudflare Workers (Durable Objects) |
| Models | HuggingFace ([skymorphosis/focalcodec-onnx](https://huggingface.co/skymorphosis/focalcodec-onnx)) |

### Themes

6 built-in themes: Catppuccin Mocha, Nord, Rose Pine, Solarized Dark, Midnight, Catppuccin Latte. Persisted in localStorage.

## Development

```bash
# Frontend
cd public && python3 -m http.server 8787

# Worker (local)
cd worker && wrangler dev --port 8788

# Deploy frontend
wrangler pages deploy public --project-name focalcodec-walkie

# Deploy worker
cd worker && wrangler deploy
```

### ONNX model export

Models exported from [FocalCodec](https://github.com/lucadellalib/focalcodec):

- **Encoder**: legacy tracer (`dynamo=False`, opset 14) due to WavLM attention incompatibility with FX exporter
- **Compressors**: standard dynamo export (opset 18)
- **Decoders**: exported without iSTFT layer — iSTFT is implemented in JavaScript (Cooley-Tukey radix-2 inverse FFT + overlap-add)

## Origin

Built as an experiment to test voice messaging over [LoRa mesh networks](https://meshtastic.org/) (Meshtastic on LILYGO T-Echo). LoRa packets max out at 237 bytes with strict duty cycle limits — FocalCodec makes voice-over-LoRa feasible at 145-577 bytes per message.

### Regulatory note (Turkey)

BTK Tablo 1 Row 21: 869.4–869.65 MHz, 500 mW ERP, 10% duty cycle. At SHORT_FAST preset, 3 LoRa packets transmit in ~4.5 seconds.

## Credits

- **[FocalCodec](https://github.com/lucadellalib/focalcodec)** — Luca Della Libera (Apache 2.0)
- **[ONNX Runtime Web](https://github.com/microsoft/onnxruntime)** — Microsoft
- **[Cloudflare Workers](https://workers.cloudflare.com/)** — WebSocket relay
- **[Meshtastic](https://meshtastic.org/)** — LoRa mesh inspiration

## License

MIT
