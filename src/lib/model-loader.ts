/**
 * Download ONNX models with IndexedDB caching and progress reporting.
 */

import { MODEL_BASE } from "./constants";
import { getCached, setCache, delCache } from "./model-cache";

/** Progress callback: value from 0 to 1 */
export type ProgressCallback = (progress: number) => void;

/** Status callback: human-readable string for UI display */
export type StatusCallback = (status: string) => void;

/** Minimum valid model size (1 MB). Anything smaller is treated as corrupt. */
const MIN_MODEL_SIZE = 1048576;

/** Bytes per megabyte */
const BYTES_PER_MB = 1048576;

/**
 * Load a model by name. Checks IndexedDB cache first, then downloads
 * from HuggingFace with streaming progress.
 *
 * @param name - Model filename (e.g. "encoder.onnx")
 * @param onProgress - Called with 0..1 as download progresses
 * @param onStatus - Called with status text for UI display
 * @returns ArrayBuffer of the model data
 */
export async function loadModel(
  name: string,
  onProgress: ProgressCallback,
  onStatus?: StatusCallback,
): Promise<ArrayBuffer> {
  // Check cache
  const cached = await getCached(name);
  if (cached && cached.byteLength > MIN_MODEL_SIZE) {
    onStatus?.(
      `${name} (cached, ${(cached.byteLength / BYTES_PER_MB).toFixed(0)} MB)`,
    );
    onProgress(1);
    return cached;
  }
  if (cached) {
    onStatus?.(`${name} cache corrupt, re-downloading`);
    await delCache(name);
  }

  // Download from HuggingFace
  onStatus?.(`Downloading ${name}...`);
  const resp = await fetch(MODEL_BASE + name);
  const total = +(resp.headers.get("Content-Length") ?? 0);
  const totalMB = total ? (total / BYTES_PER_MB).toFixed(0) + " MB" : "?";
  const t0 = performance.now();
  const reader = resp.body!.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total) onProgress(received / total);
    const elapsed = (performance.now() - t0) / 1000;
    const speed =
      elapsed > 0.5
        ? (received / BYTES_PER_MB / elapsed).toFixed(1)
        : "\u2014";
    onStatus?.(
      `${(received / BYTES_PER_MB).toFixed(1)} / ${totalMB} \u00b7 ${speed} MB/s`,
    );
  }

  const result = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  // Cache for next time (best-effort)
  try {
    await setCache(name, result.buffer);
  } catch {
    // Cache write failed — not fatal
  }

  return result.buffer;
}
