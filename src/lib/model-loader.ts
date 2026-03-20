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
  // Check IndexedDB cache first
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

  // Download from HuggingFace
  const url = MODEL_BASE + name;
  const resp = await fetch(url, { signal });
  const total = +(resp.headers.get("Content-Length") ?? "0");
  const totalMB = total ? (total / 1048576).toFixed(0) + " MB" : "?";
  onProgress({ fraction: 0, status: `Downloading ${name} (${totalMB})...` });

  const reader = resp.body!.getReader();
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
    const frac = total ? received / total : 0;
    const mb = (received / 1048576).toFixed(1);
    const elapsed = (performance.now() - t0) / 1000;
    const speed = elapsed > 0.5 ? (received / 1048576 / elapsed).toFixed(1) : "\u2014";
    onProgress({
      fraction: frac,
      status: `${mb} / ${totalMB} \u00b7 ${speed} MB/s`,
    });
  }

  const result = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  // Cache in IndexedDB
  try {
    await setCache(name, result.buffer);
  } catch {
    // cache failure is non-fatal
  }

  return result.buffer;
}
