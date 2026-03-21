import { MODEL_BASE } from "@/lib/constants";
import { getCached, setCache, delCache } from "@/lib/model-cache";

export interface ModelLoadProgress {
  /** 0..1 */
  fraction: number;
  status: string;
}

export async function loadModel(
  name: string,
  onProgress: (info: ModelLoadProgress) => void,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  // Check IndexedDB cache first (gracefully skip if IDB unavailable)
  try {
    const cached = await getCached(name);
    if (cached && cached.byteLength > 1048576) {
      onProgress({
        fraction: 1,
        status: `${name} (cached, ${(cached.byteLength / 1048576).toFixed(0)} MB)`,
      });
      return cached;
    }
    if (cached) {
      onProgress({
        fraction: 0,
        status: `${name} cache corrupt, re-downloading`,
      });
      await delCache(name);
    }
  } catch {
    // IDB unavailable or broken — fall through to network download
  }

  // Download from HuggingFace
  const url = MODEL_BASE + name;
  const resp = await fetch(url, { signal });

  if (!resp.ok) {
    throw new Error(`Failed to download ${name}: HTTP ${resp.status}`);
  }
  if (!resp.body) {
    throw new Error(`Failed to download ${name}: no response body`);
  }

  const total = +(resp.headers.get("Content-Length") ?? "0");
  const totalMB = total ? (total / 1048576).toFixed(0) + " MB" : "?";
  onProgress({ fraction: 0, status: `Downloading ${name} (${totalMB})...` });

  const reader = resp.body.getReader();

  // Stream directly into a pre-allocated buffer when size is known,
  // avoiding a second full-size copy that doubles peak memory
  if (total > 0) {
    const result = new Uint8Array(total);
    let received = 0;
    const t0 = performance.now();

    for (;;) {
      if (signal?.aborted) {
        await reader.cancel();
        throw new DOMException("Download cancelled", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) break;
      result.set(value, received);
      received += value.length;
      const frac = received / total;
      const mb = (received / 1048576).toFixed(1);
      const elapsed = (performance.now() - t0) / 1000;
      const speed = elapsed > 0.5 ? (received / 1048576 / elapsed).toFixed(1) : "\u2014";
      onProgress({
        fraction: frac,
        status: `${mb} / ${totalMB} \u00b7 ${speed} MB/s`,
      });
    }

    // Cache in IndexedDB (non-fatal if it fails)
    try {
      await setCache(name, result.buffer);
    } catch {
      // cache failure is non-fatal
    }

    return result.buffer;
  }

  // Fallback: unknown size — collect chunks then merge
  const chunks: Uint8Array[] = [];
  let received = 0;
  const t0 = performance.now();

  for (;;) {
    if (signal?.aborted) {
      await reader.cancel();
      throw new DOMException("Download cancelled", "AbortError");
    }
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const mb = (received / 1048576).toFixed(1);
    const elapsed = (performance.now() - t0) / 1000;
    const speed = elapsed > 0.5 ? (received / 1048576 / elapsed).toFixed(1) : "\u2014";
    onProgress({
      fraction: 0,
      status: `${mb} / ? \u00b7 ${speed} MB/s`,
    });
  }

  const result = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  try {
    await setCache(name, result.buffer);
  } catch {
    // cache failure is non-fatal
  }

  return result.buffer;
}
