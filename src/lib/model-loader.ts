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
  try {
    const cached = await getCached(name);
    if (signal?.aborted) throw new DOMException("Download cancelled", "AbortError");
    if (cached && cached.byteLength > 1048576) {
      onProgress({
        fraction: 1,
        status: `${name} (cached, ${(cached.byteLength / 1048576).toFixed(0)} MB)`,
      });
      return cached;
    }
    if (cached) {
      onProgress({ fraction: 0, status: `${name} cache corrupt, re-downloading` });
      await delCache(name);
    }
  } catch {
    // IDB unavailable — fall through to network
  }

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
  let result: Uint8Array;

  if (total > 0) {
    // Pre-allocate when size is known to avoid doubling peak memory
    result = new Uint8Array(total);
    await streamInto(reader, signal, total, totalMB, onProgress, (value, received) => {
      result.set(value, received - value.length);
    });
  } else {
    // Unknown size — collect chunks then merge
    const chunks: Uint8Array[] = [];
    await streamInto(reader, signal, 0, "?", onProgress, (value) => {
      chunks.push(value);
    });
    const received = chunks.reduce((s, c) => s + c.length, 0);
    result = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
  }

  try {
    await setCache(name, result.buffer.slice(0));
  } catch {
    // cache failure is non-fatal
  }

  return result.buffer;
}

/** Shared streaming loop for both download paths */
async function streamInto(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal | undefined,
  total: number,
  totalLabel: string,
  onProgress: (info: ModelLoadProgress) => void,
  onChunk: (value: Uint8Array, received: number) => void,
): Promise<void> {
  let received = 0;
  const t0 = performance.now();

  for (;;) {
    if (signal?.aborted) {
      await reader.cancel();
      throw new DOMException("Download cancelled", "AbortError");
    }
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    onChunk(value, received);
    const frac = total ? received / total : 0;
    const mb = (received / 1048576).toFixed(1);
    const elapsed = (performance.now() - t0) / 1000;
    const speed = elapsed > 0.5 ? (received / 1048576 / elapsed).toFixed(1) : "\u2014";
    onProgress({
      fraction: frac,
      status: `${mb} / ${totalLabel} \u00b7 ${speed} MB/s`,
    });
  }
}
