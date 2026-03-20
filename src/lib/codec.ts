import type { Quality } from "./constants";
import {
  SR,
  MODEL_BASE,
  MAGIC_TO_QUALITY,
  QUALITY_TO_MAGIC,
  QUALITY_RATES,
} from "./constants";
import { loadModel } from "./modelCache";
import { istft } from "./istft";

type OrtSession = Awaited<
  ReturnType<typeof ort.InferenceSession.create>
>;

let encSession: OrtSession | null = null;
const compSessions: Partial<Record<Quality, OrtSession>> = {};
const decSessions: Partial<Record<Quality, OrtSession>> = {};
let istftWin: Float32Array | null = null;

export interface ProgressCallback {
  onProgress: (fraction: number) => void;
  onStatus?: (msg: string) => void;
}

export async function loadEncoder(cb: ProgressCallback): Promise<void> {
  if (encSession) {
    cb.onProgress(1);
    return;
  }
  const bytes = await loadModel(
    "encoder.onnx",
    (p) => cb.onProgress(p * 0.7),
    cb.onStatus,
  );
  cb.onStatus?.("Initializing encoder...");
  encSession = await ort.InferenceSession.create(bytes, {
    executionProviders: ["wasm"],
  });
}

export async function loadCompressor(
  quality: Quality,
  cb: ProgressCallback,
): Promise<void> {
  if (compSessions[quality]) {
    cb.onProgress(1);
    return;
  }
  const name = `compressor_${quality}.onnx`;
  const bytes = await loadModel(name, cb.onProgress, cb.onStatus);
  cb.onStatus?.(`Initializing ${quality} compressor...`);
  compSessions[quality] = await ort.InferenceSession.create(bytes, {
    executionProviders: ["wasm"],
  });
}

export async function loadDecoder(
  quality: Quality,
  cb: ProgressCallback,
): Promise<void> {
  if (decSessions[quality]) {
    cb.onProgress(1);
    return;
  }
  const name = `decoder_${quality}.onnx`;
  const bytes = await loadModel(name, cb.onProgress, cb.onStatus);
  cb.onStatus?.(`Initializing ${quality} decoder...`);
  decSessions[quality] = await ort.InferenceSession.create(bytes, {
    executionProviders: ["wasm"],
  });
}

async function ensureIstftWindow(): Promise<Float32Array> {
  if (istftWin) return istftWin;
  const resp = await fetch("/istft_window.json");
  istftWin = new Float32Array(await resp.json());
  return istftWin;
}

export interface EncodeResult {
  packed: Uint8Array;
  tokenCount: number;
  duration: number;
}

export async function encode(
  audio: Float32Array,
  quality: Quality,
  cb: ProgressCallback,
): Promise<EncodeResult> {
  if (!encSession) throw new Error("Encoder not loaded");

  cb.onStatus?.(`Encoding (${quality})...`);
  const feats = await encSession.run({
    audio: new ort.Tensor("float32", audio, [1, audio.length]),
  });
  cb.onProgress(0.5);

  if (!compSessions[quality]) {
    cb.onStatus?.(`Loading ${quality} compressor...`);
    await loadCompressor(quality, {
      onProgress: (p) => cb.onProgress(0.5 + p * 0.2),
      onStatus: cb.onStatus,
    });
  }

  cb.onStatus?.(`Compressing (${quality})...`);
  const r = await compSessions[quality]!.run({ features: feats.features });
  const tok = r.tokens.data;
  cb.onProgress(0.9);

  const packed = new Uint8Array(1 + tok.length * 2);
  packed[0] = QUALITY_TO_MAGIC[quality];
  const dv = new DataView(packed.buffer);
  for (let i = 0; i < tok.length; i++) {
    dv.setUint16(1 + i * 2, Number(tok[i]), true);
  }
  cb.onProgress(1);

  return {
    packed,
    tokenCount: tok.length,
    duration: audio.length / SR,
  };
}

export interface ParsedTokens {
  quality: Quality;
  tokens: Uint8Array;
  tokenCount: number;
}

export function parseTokenData(data: Uint8Array): ParsedTokens | null {
  if (
    data.length >= 3 &&
    data[0] >= 0x01 &&
    data[0] <= 0x03 &&
    (data.length - 1) % 2 === 0
  ) {
    const quality = MAGIC_TO_QUALITY[data[0]];
    const tokens = data.slice(1);
    return { quality, tokens, tokenCount: tokens.length / 2 };
  }
  if (data.length >= 4 && data.length % 2 === 0) {
    const nTok = data.length / 2;
    const quality: Quality =
      nTok <= 100 ? "12_5hz" : nTok <= 200 ? "25hz" : "50hz";
    return { quality, tokens: data, tokenCount: nTok };
  }
  return null;
}

export async function decode(
  tokenData: Uint8Array,
  tokenCount: number,
  quality: Quality,
  cb: ProgressCallback,
): Promise<Float32Array> {
  const win = await ensureIstftWindow();
  cb.onProgress(0.05);

  if (!decSessions[quality]) {
    cb.onStatus?.(`Loading ${quality} decoder...`);
    await loadDecoder(quality, {
      onProgress: (p) => cb.onProgress(0.05 + p * 0.7),
      onStatus: cb.onStatus,
    });
  }

  cb.onStatus?.("Decoding...");
  cb.onProgress(0.8);

  const tokens = new BigInt64Array(tokenCount);
  const dv = new DataView(
    tokenData.buffer,
    tokenData.byteOffset,
    tokenData.byteLength,
  );
  for (let i = 0; i < tokenCount; i++) {
    tokens[i] = BigInt(dv.getUint16(i * 2, true));
  }

  const result = await decSessions[quality]!.run({
    tokens: new ort.Tensor("int64", tokens, [1, tokenCount]),
  });
  cb.onProgress(0.95);

  const audio = istft(
    result.magnitude.data as Float32Array,
    result.phase.data as Float32Array,
    win,
  );
  cb.onProgress(1);
  return audio;
}

export function estimateDuration(
  tokenCount: number,
  quality: Quality,
): number {
  return tokenCount / (QUALITY_RATES[quality] || 12.5);
}
