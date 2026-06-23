/**
 * Unified codec service for FocalCodec encode/decode.
 * Single instance shared across PTT and QR pages.
 */

import { MODEL_SIZE_ESTIMATES_MB, SR } from "@/lib/constants";
import { loadModel, type ModelLoadProgress } from "@/lib/model-loader";
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

export interface CodecProgress extends ModelLoadProgress {}

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
    await this.loadModelSet([quality], onProgress, signal);
  }

  async loadModelSet(
    qualities: Quality[],
    onProgress?: ProgressFn,
    signal?: AbortSignal,
  ): Promise<void> {
    const uniqueQualities = Array.from(new Set(qualities));
    if (uniqueQualities.length === 0) return;

    // Start iSTFT window fetch early but DO await it
    const windowPromise = this.loadIstftWindow();
    const progress = this.createModelSetProgress(uniqueQualities, onProgress);

    onProgress?.({ fraction: 0, status: "Loading models..." });
    await Promise.all([
      this.runTrackedPart(
        "encoder",
        "encoder.onnx",
        progress,
        () => this.loadEncoder(progress?.encoder, signal),
      ),
      ...uniqueQualities.flatMap((quality) => [
        this.runTrackedPart(
          `decoder_${quality}`,
          `decoder_${quality}.onnx`,
          progress,
          () => this.loadDecoder(quality, progress?.[`decoder_${quality}`], signal),
        ),
        this.runTrackedPart(
          `compressor_${quality}`,
          `compressor_${quality}.onnx`,
          progress,
          () => this.loadCompressor(quality, progress?.[`compressor_${quality}`], signal),
        ),
      ]),
    ]);

    // Ensure iSTFT window is ready before reporting success
    await windowPromise;

    onProgress?.({
      fraction: 1,
      status: `Downloaded ${uniqueQualities.map((quality) => quality === Quality.Hz12_5 ? "12.5hz" : quality).join(", ")} models loaded`,
    });
  }

  // ── Encode ──

  async encode(
    audio: Float32Array,
    quality: Quality = Quality.Hz50,
    onProgress?: ProgressFn,
    signal?: AbortSignal,
  ): Promise<EncodeResult> {
    // Load both sessions in parallel (matters on first QR encode without loadAll)
    const [encSess, compSess] = await Promise.all([
      this.loadEncoder(undefined, signal),
      this.loadCompressor(quality, undefined, signal),
    ]);

    onProgress?.({ fraction: 0.1, status: `Encoding (${quality})...` });
    const feats = await encSess.run({
      audio: new window.ort.Tensor("float32", audio, [1, audio.length]),
    });
    onProgress?.({ fraction: 0.5, status: "Compressing..." });

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

  private async createSession(
    name: string,
    onProgress?: ProgressFn,
    signal?: AbortSignal,
  ): Promise<OrtSession> {
    const buf = await loadModel(name, onProgress ?? (() => {}), signal);
    if (signal?.aborted) throw new DOMException("Load cancelled", "AbortError");
    onProgress?.({ fraction: 1, status: `Initializing ${name}...` });
    return window.ort.InferenceSession.create(buf, {
      executionProviders: ["wasm"],
    });
  }

  private async runTrackedPart(
    key: string,
    name: string,
    progress: Record<string, ProgressFn> | undefined,
    load: () => Promise<OrtSession>,
  ): Promise<OrtSession> {
    const session = await load();
    progress?.[key]?.({
      fraction: 1,
      status: `Loaded ${name}`,
      modelName: name,
      loadedBytes: this.estimatedBytes(name),
      totalBytes: this.estimatedBytes(name),
    });
    return session;
  }

  private createModelSetProgress(
    qualities: Quality[],
    onProgress?: ProgressFn,
  ): Record<string, ProgressFn> | undefined {
    if (!onProgress) return undefined;

    const names: Record<string, string> = {
      encoder: "encoder.onnx",
    };
    for (const quality of qualities) {
      names[`decoder_${quality}`] = `decoder_${quality}.onnx`;
      names[`compressor_${quality}`] = `compressor_${quality}.onnx`;
    }
    const expectedBytes = Object.fromEntries(
      Object.entries(names).map(([key, name]) => [key, this.estimatedBytes(name)]),
    );
    const loadedBytes = Object.fromEntries(
      Object.keys(names).map((key) => [key, 0]),
    );
    const speeds: Partial<Record<keyof typeof names, number>> = {};
    const totalBytes = Object.values(expectedBytes).reduce(
      (sum, bytes) => sum + bytes,
      0,
    );
    let lastFraction = 0;
    const reports: Record<string, ProgressFn> = {};

    const report =
      (part: keyof typeof names): ProgressFn =>
      (info) => {
        const expected = expectedBytes[part];
        const nextLoaded =
          info.loadedBytes ?? Math.max(0, info.fraction) * expected;
        loadedBytes[part] = Math.max(
          loadedBytes[part],
          Math.min(expected, nextLoaded),
        );
        if (info.fraction >= 1) {
          loadedBytes[part] = expected;
          delete speeds[part];
        } else if (info.speedMBps !== undefined) {
          speeds[part] = info.speedMBps;
        }

        const loaded =
          Object.values(loadedBytes).reduce((sum, bytes) => sum + bytes, 0);
        const rawFraction = totalBytes > 0 ? loaded / totalBytes : info.fraction;
        lastFraction = Math.max(lastFraction, Math.min(rawFraction, 0.995));
        onProgress({
          fraction: lastFraction,
          status: this.formatLoadAllStatus(
            loaded,
            totalBytes,
            Object.values(speeds).reduce<number>(
              (sum, speed) => sum + (speed ?? 0),
              0,
            ),
            info.status,
          ),
        });
      };

    for (const key of Object.keys(names)) reports[key] = report(key);
    return reports;
  }

  private estimatedBytes(name: string): number {
    return (MODEL_SIZE_ESTIMATES_MB[name] ?? 1) * 1048576;
  }

  private formatLoadAllStatus(
    loadedBytes: number,
    totalBytes: number,
    speedMBps: number,
    fallback: string,
  ): string {
    if (loadedBytes <= 0 || totalBytes <= 0) return fallback;
    if (loadedBytes >= totalBytes) {
      return fallback.startsWith("Initializing")
        ? "Initializing models..."
        : fallback;
    }

    const loaded = (loadedBytes / 1048576).toFixed(1);
    const total = (totalBytes / 1048576).toFixed(0);
    const speed = speedMBps > 0 ? ` · ${speedMBps.toFixed(1)} MB/s` : "";
    return `${loaded} / ~${total} MB${speed}`;
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
        return this.loadDecoder(
          quality,
          (info) =>
            onProgress?.({
              fraction: info.fraction * 0.75,
              status: info.status,
            }),
          signal,
        );
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
