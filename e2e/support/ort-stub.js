// Injected with page.addInitScript before any app code runs. Replaces the
// onnxruntime-web global with a deterministic stand-in so the UI state
// machine can be driven without WASM inference or real 600 MB models.
//
// Fake model bodies (served by e2e/support/model-server.ts) start with the
// model filename followed by a NUL byte, so a session knows which model it
// is — including when the bytes come back out of IndexedDB.
//
// Behaviour is controllable per page via `window.__tv` (see test.ts `ort`):
//   delayMs       — artificial latency for every run()
//   createDelayMs — artificial latency for InferenceSession.create()
//   failRun       — model-name substring whose run() rejects
//   failCreate    — model-name substring whose create() rejects
//   failMessage   — message used by the simulated failures
//   sessions      — model names created, in order
//   runs          — { model, dims } for every run()
(() => {
  const HOP = 320;
  const BINS = 513; // NFFT / 2 + 1
  const RATES = { "50hz": 50, "25hz": 25, "12_5hz": 12.5 };
  const MAGIC = { "50hz": 1, "25hz": 2, "12_5hz": 3 };

  const state = {
    delayMs: 0,
    createDelayMs: 0,
    failRun: null,
    failCreate: null,
    failMessage: "E2E stub: simulated inference failure",
    sessions: [],
    runs: [],
  };
  Object.defineProperty(window, "__tv", { value: state, writable: false });

  const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

  class Tensor {
    constructor(type, data, dims) {
      this.type = type;
      this.data = data;
      this.dims = dims;
    }
  }

  function modelName(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let name = "";
    for (let i = 0; i < 64 && bytes[i]; i++) name += String.fromCharCode(bytes[i]);
    return name;
  }

  function qualityOf(name) {
    const match = /^(?:compressor|decoder)_(50hz|25hz|12_5hz)\.onnx$/.exec(name);
    return match ? match[1] : null;
  }

  function run(name, feeds) {
    if (name === "encoder.onnx") {
      const audio = feeds.audio;
      const samples = audio.dims[1];
      const frames = Math.max(1, Math.floor(samples / HOP));
      return { features: new Tensor("float32", new Float32Array(frames), [1, frames, 1]) };
    }
    const quality = qualityOf(name);
    if (name.startsWith("compressor_")) {
      const frames = feeds.features.dims[1];
      const count = Math.max(1, Math.round((frames * RATES[quality]) / 50));
      const tokens = new BigInt64Array(count);
      for (let i = 0; i < count; i++) {
        tokens[i] = BigInt((i * 37 + MAGIC[quality] * 1000 + 11) % 65536);
      }
      return { tokens: new Tensor("int64", tokens, [1, count]) };
    }
    if (name.startsWith("decoder_")) {
      const count = feeds.tokens.dims[1];
      const frames = Math.max(1, Math.round((count * 50) / RATES[quality]));
      const magnitude = new Float32Array(BINS * frames);
      const phase = new Float32Array(BINS * frames);
      // A single ~440 Hz partial so the decoded buffer is audibly non-zero.
      for (let f = 0; f < frames; f++) magnitude[f * BINS + 28] = 120;
      return {
        magnitude: new Tensor("float32", magnitude, [1, BINS, frames]),
        phase: new Tensor("float32", phase, [1, BINS, frames]),
      };
    }
    throw new Error(`E2E ort stub: no behaviour for ${name}`);
  }

  const InferenceSession = {
    async create(buffer) {
      const name = modelName(buffer);
      if (!/^(encoder|compressor_(50hz|25hz|12_5hz)|decoder_(50hz|25hz|12_5hz))\.onnx$/.test(name)) {
        throw new Error(`E2E ort stub: unrecognised model bytes (${JSON.stringify(name)})`);
      }
      await sleep(state.createDelayMs);
      if (state.failCreate && name.includes(state.failCreate)) {
        throw new Error(state.failMessage);
      }
      state.sessions.push(name);
      return {
        name,
        async run(feeds) {
          state.runs.push({
            model: name,
            dims: Object.fromEntries(Object.entries(feeds).map(([k, v]) => [k, v.dims])),
          });
          await sleep(state.delayMs);
          if (state.failRun && name.includes(state.failRun)) {
            throw new Error(state.failMessage);
          }
          return run(name, feeds);
        },
      };
    },
  };

  window.ort = { Tensor, InferenceSession, env: {} };
})();
