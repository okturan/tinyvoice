# FocalCodec Walkie-Talkie

Voice chat over 576 bytes. A push-to-talk app that compresses 5.8 seconds of speech into 576 bytes using a 142M-parameter neural speech codec running entirely in your browser via WebAssembly.

**[Try the live demo](https://focalcodec-walkie.pages.dev)**

## How it works

```
Speaker's browser                          Listener's browser
┌──────────────────────┐                   ┌──────────────────────┐
│ Mic → WavLM Encoder  │                   │  Vocos Decoder       │
│    → Compressor      │  ── 576 bytes ──▸ │    → iSTFT (JS)      │
│    → Quantizer       │   (WebSocket)     │    → Speaker         │
└──────────────────────┘                   └──────────────────────┘
      ONNX Runtime (WASM)                       ONNX Runtime (WASM)
```

1. **Record** — hold the PTT button, speak
2. **Encode** — FocalCodec encoder (142M params) runs in WASM, produces ~50 tokens/sec
3. **Transmit** — 576 bytes sent via WebSocket to a Cloudflare Worker relay
4. **Decode** — FocalCodec decoder (ONNX) + iSTFT (pure JavaScript) reconstructs audio
5. **Play** — decoded audio plays on the listener's device

All neural network inference happens in the browser. The relay server only forwards raw bytes — it never sees or processes audio.

## Numbers

| Metric | Value |
|--------|-------|
| Speech duration | 5.78 seconds |
| Compressed size | 576 bytes |
| Compression ratio | 5,123x |
| Tokens | 288 (50 tokens/sec) |
| Codebook | 8,192 entries (13-bit) |
| Encode time | ~0.13s (warmed up, M1 GPU) |
| Decode time | ~0.06s (warmed up, M1 GPU) |
| Browser encode (WASM) | ~4s |
| Browser decode (WASM) | ~4s |
| Model size | 595 MB encoder + 135 MB decoder |

## Architecture

### Frontend (`public/`)

Single-page app with no build step. Three files:

- **`index.html`** — app logic: ONNX model loading, IndexedDB caching, WebSocket, PTT recording, iSTFT implementation, theme system
- **`themes.css`** — 6 color themes (Catppuccin Mocha/Frappe, Nord, Rose Pine, Solarized Dark, Catppuccin Latte)
- **`app.css`** — layout and components

The iSTFT (inverse Short-Time Fourier Transform) is implemented in pure JavaScript — a Cooley-Tukey radix-2 inverse FFT with overlap-add synthesis. This was necessary because the ONNX exporter can't handle PyTorch's `torch.fft.irfft` operation.

### Relay Worker (`worker/`)

Cloudflare Worker with two Durable Objects:

- **Room** — WebSocket relay that forwards binary packets between connected users
- **Lobby** — tracks active rooms and user counts for the room list

The worker never inspects packet contents. It's a dumb pipe.

### ONNX Models

Hosted on HuggingFace: [`skymorphosis/focalcodec-onnx`](https://huggingface.co/skymorphosis/focalcodec-onnx)

The models are split for efficiency — the encoder (WavLM) is shared across all quality levels, only the compressor/decompressor differs:

| File | Size | Component |
|------|------|-----------|
| `encoder.onnx` | 595 MB | WavLM encoder (shared) |
| `compressor_50hz.onnx` | 70 MB | 50hz compressor + quantizer |
| `compressor_25hz.onnx` | 74 MB | 25hz compressor + quantizer |
| `compressor_12_5hz.onnx` | 76 MB | 12.5hz compressor + quantizer |
| `decoder_50hz.onnx` | 135 MB | 50hz decompressor + Vocos decoder |
| `decoder_25hz.onnx` | 139 MB | 25hz decompressor + Vocos decoder |
| `decoder_12_5hz.onnx` | 141 MB | 12.5hz decompressor + Vocos decoder |

Models are cached in IndexedDB after first download — subsequent visits load from local storage in ~1-2 seconds.

### Quality Levels

| Config | Token rate | Bytes per 5.8s | LoRa packets | Quality |
|--------|-----------|----------------|--------------|---------|
| 50hz | 50 tokens/sec | 576 | 3 | Best |
| 25hz | 25 tokens/sec | 288 | 2 | Good |
| 12.5hz | 12.5 tokens/sec | 144 | 1 | Acceptable |

## Why this exists

This started as an experiment to see if voice messaging is feasible over [LoRa mesh networks](https://meshtastic.org/) (like Meshtastic on LILYGO T-Echo devices). LoRa packets are limited to 237 bytes with strict duty cycle regulations.

At 576 bytes (3 packets) or 144 bytes (1 packet), FocalCodec makes voice-over-LoRa possible.

### Regulatory context (Turkey)

Per BTK Tablo 1 Row 21: 869.4–869.65 MHz allows 500 mW ERP with 10% duty cycle. At SHORT_FAST preset, 3 LoRa packets take ~4.5 seconds to transmit — well within duty cycle limits.

## Development

```bash
# Serve frontend locally
cd public && python3 -m http.server 8787

# Run worker locally
cd worker && wrangler dev --port 8788

# Deploy frontend
wrangler pages deploy public --project-name focalcodec-walkie

# Deploy worker
cd worker && wrangler deploy
```

### Exporting ONNX models

The models were exported from [FocalCodec](https://github.com/lucadellalib/focalcodec) using PyTorch's ONNX exporter. The encoder requires the legacy tracer (`dynamo=False`) due to WavLM attention layer incompatibilities with the new FX-based exporter. The decoder is exported without the iSTFT layer, which is implemented in JavaScript instead.

See the codec test scripts in the project's development history for export details.

## Credits

- **[FocalCodec](https://github.com/lucadellalib/focalcodec)** by Luca Della Libera — the neural speech codec (Apache 2.0)
- **[ONNX Runtime Web](https://github.com/microsoft/onnxruntime)** — browser-based ML inference
- **[Cloudflare Workers](https://workers.cloudflare.com/)** — WebSocket relay
- **[Meshtastic](https://meshtastic.org/)** — the LoRa mesh network that inspired this project

## License

MIT
