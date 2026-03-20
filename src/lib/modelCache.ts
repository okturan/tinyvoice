import { MODEL_BASE } from "./constants";

const DB_NAME = "focalcodec-models";
const STORE_NAME = "models";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getCached(key: string): Promise<ArrayBuffer | null> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

async function setCache(key: string, data: ArrayBuffer): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(data, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function delCache(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function loadModel(
  name: string,
  onProgress: (fraction: number) => void,
  onStatus?: (msg: string) => void,
): Promise<ArrayBuffer> {
  const cached = await getCached(name);
  if (cached && cached.byteLength > 1048576) {
    onStatus?.(
      `${name} (cached, ${(cached.byteLength / 1048576).toFixed(0)} MB)`,
    );
    onProgress(1);
    return cached;
  }
  if (cached) {
    onStatus?.(`${name} cache corrupt, re-downloading`);
    await delCache(name);
  }

  onStatus?.(`Downloading ${name}...`);
  const resp = await fetch(MODEL_BASE + name);
  const total = +(resp.headers.get("Content-Length") ?? 0);
  const totalMB = total ? (total / 1048576).toFixed(0) + " MB" : "?";
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
      elapsed > 0.5 ? (received / 1048576 / elapsed).toFixed(1) : "\u2014";
    onStatus?.(
      `${(received / 1048576).toFixed(1)} / ${totalMB} \u00b7 ${speed} MB/s`,
    );
  }

  const result = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  try {
    await setCache(name, result.buffer as ArrayBuffer);
  } catch {
    // ignore storage errors
  }

  return result.buffer as ArrayBuffer;
}
