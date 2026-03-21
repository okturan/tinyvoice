/**
 * Unified codec service for FocalCodec encode/decode.
 * Single instance shared across PTT and QR pages.
 */

import { SR } from "@/lib/constants";
import { loadModel } from "@/lib/model-loader";
import { areCached } from "@/lib/model-cache";
import { istft } from "@/lib/istft";
import {
  Quality,
  QUALITY_RATES,
  type WirePacket,
} from "@/types/codec";
import {
  packTokens,
  unpackTokens,
  tokenBytesToBigInt64,
} from "@/lib/wire-format";

type OrtSession = ort.InferenceSession;

export interface CodecProgress {
  fraction: number;
  status: string;
}

export type ProgressFn = (info: CodecProgress) => void;

export interface EncodeResult {
  packed: Uint8Array;
  tokenCount: number;
  duration: number;
}

/** Re-export for convenience */
export type { WirePacket as ParsedPacket };

class CodecService {
  private encoder: Promise<OrtSession> | null = null;
  private compressors: Partial<Record<Quality, Promise<OrtSession>>> = {};
  private decoders: Partial<Record<Quality, Promise<OrtSession>>> = {};
  private istftWindow: Promise<Float32Array> | null = null;

  /** Generation counter — bumped on reset() to invalidate stale loads */
  private generation = 0;

  // ── Individual loaders ──

  loadEncoder(
    onProgress?: ProgressFn,
    signal?: AbortSignal,
  ): Promise<OrtSession> {
    if (this.encoder) return this.encoder;
    const gen = this.generation;
    const promise = this.createSession("encoder.onnx", onProgress, signal);
    this.encoder = promise;
    promise.catch(() => {
      if (this.generation === gen) this.encoder = null;
    });
    return promise;
  }

  loadCompressor(
    quality: Quality,
    onProgress?: ProgressFn,
    signal?: AbortSignal,
  ): Promise<OrtSession> {
    const existing = this.compressors[quality];
    if (existing) return existing;
    const gen = this.generation;
    const name = `compressor_${quality}.onnx`;
    const promise = this.createSession(name, onProgress, signal);
    this.compressors[quality] = promise;
    promise.catch(() => {
      if (this.generation === gen) delete this.compressors[quality];
    });
    return promise;
  }

  loadDecoder(
    quality: Quality,
    onProgress?: ProgressFn,
    signal?: AbortSignal,
  ): Promise<OrtSession> {
    const existing = this.decoders[quality];
    if (existing) return existing;
    const gen = this.generation;
    const name = `decoder_${quality}.onnx`;
    const promise = this.createSession(name, onProgress, signal);
    this.decoders[quality] = promise;
    promise.catch(() => {
      if (this.generation === gen) delete this.decoders[quality];
    });
    return promise;
  }

  loadIstftWindow(): Promise<Float32Array> {
    if (this.istftWindow) return this.istftWindow;
    const gen = this.generation;
    const promise = fetch("/istft_window.json")
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load iSTFT window: HTTP ${r.status}`);
        return r.json();
      })
      .then((arr: number[]) => new Float32Array(arr));
    this.istftWindow = promise;
    promise.catch(() => {
      if (this.generation === gen) this.istftWindow = null;
    });
    return promise;
  }

  // ── Bulk loader (PTT page uses this) ──

  async loadAll(
    quality: Quality,
    onProgress?: ProgressFn,
    signal?: AbortSignal,
  ): Promise<void> {
    // Start iSTFT window fetch early but DO await it
    const windowPromise = this.loadIstftWindow();

    // Decoder and encoder are independent — download in parallel
    onProgress?.({ fraction: 0, status: "Loading models..." });
    await Promise.all([
      this.loadDecoder(
        quality,
        this.scaleProgress(onProgress, 0, 0.15),
        signal,
      ),
      this.loadEncoder(
        this.scaleProgress(onProgress, 0.15, 0.65),
        signal,
      ),
    ]);

    onProgress?.({ fraction: 0.8, status: "Compressor..." });
    await this.loadCompressor(
      quality,
      this.scaleProgress(onProgress, 0.8, 0.2),
      signal,
    );

    // Ensure iSTFT window is ready before reporting success
    await windowPromise;

    onProgress?.({
      fraction: 1,
      status: `Ready — encoder + ${quality} comp/dec`,
    });
  }

  // ── Encode ──

  async encode(
    audio: Float32Array,
    quality: Quality = Quality.Hz50,
    onProgress?: ProgressFn,
    signal?: AbortSignal,
  ): Promise<EncodeResult> {
    const encSess = await this.loadEncoder(undefined, signal);

    onProgress?.({ fraction: 0.1, status: `Encoding (${quality})...` });
    const feats = await encSess.run({
      audio: new window.ort.Tensor("float32", audio, [1, audio.length]),
    });
    onProgress?.({ fraction: 0.5, status: "Compressing..." });

    const compSess = await this.loadCompressor(quality, undefined, signal);
    const r = await compSess.run({ features: feats.features });
    const tok = r.tokens.data as BigInt64Array;
    onProgress?.({ fraction: 0.9, status: "Packing..." });

    const packed = packTokens(tok, quality);
    onProgress?.({ fraction: 1, status: "Done" });

    return {
      packed,
      tokenCount: tok.length,
      duration: audio.length / SR,
    };
  }

  // ── Decode from raw packet (with magic byte) ──

  async decode(
    packet: Uint8Array,
    qualityOverride?: Quality,
    onProgress?: ProgressFn,
    signal?: AbortSignal,
  ): Promise<Float32Array> {
    const parsed = unpackTokens(packet);
    if (!parsed) throw new Error("Invalid voice packet");

    const quality = qualityOverride ?? parsed.quality;
    const tokens = tokenBytesToBigInt64(parsed.tokenBytes);

    return this.decodeFromTokens(tokens, quality, onProgress, signal);
  }

  // ── Decode from pre-parsed token bytes ──

  async decodeTokens(
    tokenBytes: Uint8Array,
    tokenCount: number,
    quality: Quality,
    onProgress?: ProgressFn,
    signal?: AbortSignal,
  ): Promise<Float32Array> {
    const tokens = tokenBytesToBigInt64(tokenBytes);
    if (tokens.length !== tokenCount) {
      throw new Error(
        `Token count mismatch: expected ${tokenCount}, got ${tokens.length}`,
      );
    }
    return this.decodeFromTokens(tokens, quality, onProgress, signal);
  }

  // ── Utilities ──

  parsePacket(data: Uint8Array): WirePacket | null {
    return unpackTokens(data);
  }

  estimateDuration(tokenCount: number, quality: Quality): number {
    return tokenCount / (QUALITY_RATES[quality] || 12.5);
  }

  // ── Lifecycle ──

  /** Clear all cached sessions. Bumps generation to invalidate in-flight loads. */
  reset(): void {
    this.generation++;
    this.encoder = null;
    this.compressors = {};
    this.decoders = {};
    this.istftWindow = null;
  }

  async isCoreModelsCached(
    quality: Quality = Quality.Hz50,
  ): Promise<boolean> {
    try {
      const keys = [
        "encoder.onnx",
        `compressor_${quality}.onnx`,
        `decoder_${quality}.onnx`,
      ];
      const results = await areCached(keys);
      return keys.every((k) => results[k]);
    } catch {
      return false;
    }
  }

  // ── Private helpers ──

  private scaleProgress(
    fn: ProgressFn | undefined,
    base: number,
    scale: number,
  ): ProgressFn | undefined {
    if (!fn) return undefined;
    return (info) => fn({ fraction: base + info.fraction * scale, status: info.status });
  }

  private async createSession(
    name: string,
    onProgress?: ProgressFn,
    signal?: AbortSignal,
  ): Promise<OrtSession> {
    const buf = await loadModel(name, onProgress ?? (() => {}), signal);
    onProgress?.({ fraction: 1, status: `Initializing ${name}...` });
    return window.ort.InferenceSession.create(buf, {
      executionProviders: ["wasm"],
    });
  }

  private async decodeFromTokens(
    tokens: BigInt64Array,
    quality: Quality,
    onProgress?: ProgressFn,
    signal?: AbortSignal,
  ): Promise<Float32Array> {
    // Window fetch and decoder load are independent — start both
    const [win, decSess] = await Promise.all([
      this.loadIstftWindow(),
      (async () => {
        onProgress?.({ fraction: 0.05, status: "Loading decoder..." });
        return this.loadDecoder(quality, undefined, signal);
      })(),
    ]);
    onProgress?.({ fraction: 0.8, status: "Decoding..." });

    const result = await decSess.run({
      tokens: new window.ort.Tensor("int64", tokens, [1, tokens.length]),
    });
    onProgress?.({ fraction: 0.95, status: "iSTFT..." });

    const audio = istft(
      result.magnitude.data as Float32Array,
      result.phase.data as Float32Array,
      win,
    );
    onProgress?.({ fraction: 1, status: "Done" });
    return audio;
  }
}

/** Singleton codec instance shared across all pages */
export const codec = new CodecService();
