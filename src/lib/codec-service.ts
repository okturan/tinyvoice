/**
 * Unified codec service for FocalCodec encode/decode.
 * Single instance shared across PTT and QR pages.
 */

import { MODEL_SIZE_ESTIMATES_MB, SR } from "@/lib/constants";
import { qualityLabel } from "@/lib/format";
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

export type LoadIntent = "record" | "play" | "both";

export class ModelArtifactError extends Error {
  modelName: string;

  constructor(message: string, modelName: string) {
    super(message);
    this.name = "ModelArtifactError";
    this.modelName = modelName;
  }
}

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
    if (signal?.aborted) {
      return Promise.reject(new DOMException("Load cancelled", "AbortError"));
    }
    if (this.encoder) {
      return this.reuseOrReload(
        this.encoder,
        () => {
          this.encoder = null;
          return this.loadEncoder(onProgress, signal);
        },
        signal,
      );
    }
    const gen = this.generation;
    const promise = this.createSession("encoder.onnx", onProgress, signal);
    this.encoder = promise;
    promise.catch(() => {
      if (this.generation === gen && this.encoder === promise) this.encoder = null;
    });
    return promise;
  }

  loadCompressor(
    quality: Quality,
    onProgress?: ProgressFn,
    signal?: AbortSignal,
  ): Promise<OrtSession> {
    if (signal?.aborted) {
      return Promise.reject(new DOMException("Load cancelled", "AbortError"));
    }
    const existing = this.compressors[quality];
    if (existing) {
      return this.reuseOrReload(
        existing,
        () => {
          delete this.compressors[quality];
          return this.loadCompressor(quality, onProgress, signal);
        },
        signal,
      );
    }
    const gen = this.generation;
    const name = `compressor_${quality}.onnx`;
    const promise = this.createSession(name, onProgress, signal);
    this.compressors[quality] = promise;
    promise.catch(() => {
      if (this.generation === gen && this.compressors[quality] === promise) {
        delete this.compressors[quality];
      }
    });
    return promise;
  }

  loadDecoder(
    quality: Quality,
    onProgress?: ProgressFn,
    signal?: AbortSignal,
  ): Promise<OrtSession> {
    if (signal?.aborted) {
      return Promise.reject(new DOMException("Load cancelled", "AbortError"));
    }
    const existing = this.decoders[quality];
    if (existing) {
      return this.reuseOrReload(
        existing,
        () => {
          delete this.decoders[quality];
          return this.loadDecoder(quality, onProgress, signal);
        },
        signal,
      );
    }
    const gen = this.generation;
    const name = `decoder_${quality}.onnx`;
    const promise = this.createSession(name, onProgress, signal);
    this.decoders[quality] = promise;
    promise.catch(() => {
      if (this.generation === gen && this.decoders[quality] === promise) {
        delete this.decoders[quality];
      }
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
    intent: LoadIntent = "both",
  ): Promise<void> {
    const uniqueQualities = Array.from(new Set(qualities));
    if (uniqueQualities.length === 0) return;

    const loadEncoder = intent !== "play";
    const loadCompressor = intent !== "play";
    const loadDecoder = intent !== "record";

    const windowPromise = this.loadIstftWindow();
    const partNames: Record<string, string> = {};
    if (loadEncoder) partNames.encoder = "encoder.onnx";
    for (const quality of uniqueQualities) {
      if (loadDecoder) partNames[`decoder_${quality}`] = `decoder_${quality}.onnx`;
      if (loadCompressor) partNames[`compressor_${quality}`] = `compressor_${quality}.onnx`;
    }
    const progress = this.createModelSetProgress(partNames, onProgress);

    onProgress?.({ fraction: 0, status: "Loading models..." });
    const parts: Promise<OrtSession>[] = [];
    if (loadEncoder) {
      parts.push(this.runTrackedPart(
        "encoder",
        "encoder.onnx",
        progress,
        () => this.loadEncoder(progress?.encoder, signal),
      ));
    }
    for (const quality of uniqueQualities) {
      if (loadDecoder) {
        parts.push(this.runTrackedPart(
          `decoder_${quality}`,
          `decoder_${quality}.onnx`,
          progress,
          () => this.loadDecoder(quality, progress?.[`decoder_${quality}`], signal),
        ));
      }
      if (loadCompressor) {
        parts.push(this.runTrackedPart(
          `compressor_${quality}`,
          `compressor_${quality}.onnx`,
          progress,
          () => this.loadCompressor(quality, progress?.[`compressor_${quality}`], signal),
        ));
      }
    }
    await Promise.all(parts);

    await windowPromise;

    if (signal?.aborted) throw new DOMException("Load cancelled", "AbortError");

    onProgress?.({
      fraction: 1,
      status: `${uniqueQualities.map((quality) => quality === Quality.Hz12_5 ? "12.5hz" : quality).join(", ")} loaded`,
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

    onProgress?.({ fraction: 0.1, status: `Encoding (${qualityLabel(quality)})...` });
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

  /** Drop one artifact's cached session so a retry rebuilds it. */
  resetArtifact(name: string): void {
    if (name === "encoder.onnx") {
      this.encoder = null;
      return;
    }
    const compressor = /^compressor_(.+)\.onnx$/.exec(name);
    if (compressor) {
      delete this.compressors[compressor[1] as Quality];
      return;
    }
    const decoder = /^decoder_(.+)\.onnx$/.exec(name);
    if (decoder) {
      delete this.decoders[decoder[1] as Quality];
    }
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

  private reuseOrReload(
    existing: Promise<OrtSession>,
    reload: () => Promise<OrtSession>,
    signal?: AbortSignal,
  ): Promise<OrtSession> {
    return existing.then(
      (session) => session,
      (error) => {
        if (error instanceof DOMException && error.name === "AbortError" && !signal?.aborted) {
          return reload();
        }
        throw error;
      },
    );
  }

  private async createSession(
    name: string,
    onProgress?: ProgressFn,
    signal?: AbortSignal,
  ): Promise<OrtSession> {
    try {
      const buf = await loadModel(name, onProgress ?? (() => {}), signal);
      if (signal?.aborted) throw new DOMException("Load cancelled", "AbortError");
      onProgress?.({ fraction: 1, status: `Initializing ${name}...`, modelName: name });
      const session = await window.ort.InferenceSession.create(buf, {
        executionProviders: ["wasm"],
      });
      if (signal?.aborted) throw new DOMException("Load cancelled", "AbortError");
      return session;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new ModelArtifactError(message, name);
    }
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
    names: Record<string, string>,
    onProgress?: ProgressFn,
  ): Record<string, ProgressFn> | undefined {
    if (!onProgress) return undefined;
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
