import { MODEL_ARTIFACT_BYTES, MODEL_BASE } from "@/lib/constants";
import { getCached, setCache, delCache } from "@/lib/model-cache";

const MIN_MODEL_BYTES = 1024 * 1024;
export const MAX_MODEL_BYTES = 1024 * 1024 * 1024;
const MODEL_FILE_PATTERN = /^[a-z0-9][a-z0-9_.-]*\.onnx$/iu;

export interface ModelLoadProgress {
  /** 0..1 */
  fraction: number;
  status: string;
  modelName?: string;
  loadedBytes?: number;
  totalBytes?: number;
  speedMBps?: number;
}

export function modelUrl(name: string): string {
  if (!MODEL_FILE_PATTERN.test(name) || name.includes("..")) {
    throw new Error(`Invalid model filename: ${name}`);
  }
  return new URL(encodeURIComponent(name), MODEL_BASE).toString();
}

export function parseContentLength(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^[0-9]+$/u.test(value)) {
    throw new Error("Model response has an invalid Content-Length header");
  }
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < MIN_MODEL_BYTES || size > MAX_MODEL_BYTES) {
    throw new Error(`Model response size ${value} is outside the accepted range`);
  }
  return size;
}

export async function loadModel(
  name: string,
  onProgress: (info: ModelLoadProgress) => void,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  const url = modelUrl(name);
  const expectedBytes = MODEL_ARTIFACT_BYTES[name];
  if (expectedBytes === undefined) {
    throw new Error(`Model is not in the pinned artifact manifest: ${name}`);
  }
  throwIfAborted(signal);

  try {
    const cached = await getCached(name);
    throwIfAborted(signal);
    if (cached && cached.byteLength === expectedBytes) {
      onProgress({
        fraction: 1,
        status: `${name} (cached, ${(cached.byteLength / 1048576).toFixed(0)} MB)`,
        modelName: name,
        loadedBytes: cached.byteLength,
        totalBytes: cached.byteLength,
      });
      return cached;
    }
    if (cached) {
      onProgress({
        fraction: 0,
        status: `${name} cache corrupt, re-downloading`,
        modelName: name,
      });
      await delCache(name);
    }
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw abortError();
    // IndexedDB unavailable: continue with a network-only load.
  }

  const resp = await fetch(url, { signal });
  if (!resp.ok) {
    throw new Error(`Failed to download ${name}: HTTP ${resp.status}`);
  }
  if (!resp.body) {
    throw new Error(`Failed to download ${name}: no response body`);
  }

  const declaredBytes = parseContentLength(resp.headers.get("Content-Length"));
  if (declaredBytes !== undefined && declaredBytes !== expectedBytes) {
    throw new Error(
      `Failed to download ${name}: expected ${expectedBytes} bytes, server declared ${declaredBytes}`,
    );
  }
  const total = expectedBytes;
  const totalLabel = `${(total / 1048576).toFixed(0)} MB`;
  onProgress({
    fraction: 0,
    status: `Downloading ${name} (${totalLabel})...`,
    modelName: name,
    loadedBytes: 0,
    totalBytes: total,
  });

  const reader = resp.body.getReader();
  const result = new Uint8Array(new ArrayBuffer(total));
  await streamInto(
    reader,
    signal,
    name,
    total,
    totalLabel,
    onProgress,
    (value, nextReceived) => result.set(value, nextReceived - value.length),
  );

  try {
    await setCache(name, result.buffer);
  } catch {
    // A cache failure is non-fatal; the downloaded model is still usable.
  }

  return result.buffer;
}

async function streamInto(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal | undefined,
  modelName: string,
  total: number | undefined,
  totalLabel: string,
  onProgress: (info: ModelLoadProgress) => void,
  onChunk: (value: Uint8Array, received: number) => void,
): Promise<number> {
  let received = 0;
  const t0 = performance.now();

  for (;;) {
    if (signal?.aborted) {
      await reader.cancel();
      throw abortError();
    }
    const { done, value } = await reader.read();
    if (done) break;

    const nextReceived = received + value.byteLength;
    if (nextReceived > MAX_MODEL_BYTES || (total !== undefined && nextReceived > total)) {
      await reader.cancel();
      throw new Error(`Failed to download ${modelName}: response exceeded its declared or allowed size`);
    }
    received = nextReceived;
    onChunk(value, received);

    const fraction = total === undefined ? 0 : received / total;
    const megabytes = (received / 1048576).toFixed(1);
    const elapsed = (performance.now() - t0) / 1000;
    const speed = elapsed > 0.5 ? received / 1048576 / elapsed : undefined;
    onProgress({
      fraction,
      status: `${megabytes} / ${totalLabel} \u00b7 ${speed ? speed.toFixed(1) : "\u2014"} MB/s`,
      modelName,
      loadedBytes: received,
      totalBytes: total,
      speedMBps: speed,
    });
  }

  if (total !== undefined && received !== total) {
    throw new Error(`Failed to download ${modelName}: expected ${total} bytes, received ${received}`);
  }
  return received;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): DOMException {
  return new DOMException("Download cancelled", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
