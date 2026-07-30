import { MODEL_REVISION } from "@/lib/constants";

const DB_NAME = "focalcodec-models";
const STORE_NAME = "models";
const CHUNK_STORE_NAME = "model-chunks";
const DB_VERSION = 3;
const CHUNK_BYTES = 16 * 1024 * 1024;
const CACHE_PREFIX = `${MODEL_REVISION}:`;

interface ChunkedCacheMetadata {
  format: "chunked-v1";
  byteLength: number;
  chunkCount: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;
let persistencePromise: Promise<boolean | null> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    let settled = false;
    const timeout = setTimeout(() => rejectOpen(new Error("Model cache open timed out")), 5000);
    const rejectOpen = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      dbPromise = null;
      reject(error);
    };
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
      if (!req.result.objectStoreNames.contains(CHUNK_STORE_NAME)) {
        req.result.createObjectStore(CHUNK_STORE_NAME);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      if (settled) {
        db.close();
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(db);
    };
    req.onerror = () => rejectOpen(req.error ?? new Error("Model cache open failed"));
    req.onblocked = () => rejectOpen(new Error("Model cache upgrade is blocked by another tab"));
  });
  return dbPromise;
}

export async function getCached(key: string): Promise<ArrayBuffer | null> {
  const db = await openDB();
  const stored = await new Promise<unknown>((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(cacheKey(key));
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  });
  if (stored instanceof ArrayBuffer) return stored;
  if (!isChunkedCacheMetadata(stored)) return null;

  try {
    const result = new Uint8Array(new ArrayBuffer(stored.byteLength));
    let offset = 0;
    for (let index = 0; index < stored.chunkCount; index++) {
      const chunk = await readChunk(db, chunkKey(key, index));
      if (!chunk) throw new Error("Model cache chunk is missing");
      const bytes = chunk instanceof Blob
        ? new Uint8Array(await chunk.arrayBuffer())
        : new Uint8Array(chunk);
      if (offset + bytes.byteLength > result.byteLength) {
        throw new Error("Model cache chunks exceed declared size");
      }
      result.set(bytes, offset);
      offset += bytes.byteLength;
    }
    if (offset !== result.byteLength) {
      throw new Error("Model cache chunks do not match declared size");
    }
    return result.buffer;
  } catch {
    await delCache(key);
    return null;
  }
}

export async function setCache(key: string, data: ArrayBuffer): Promise<void> {
  const db = await openDB();
  await deleteCacheEntry(db, key);

  const chunkCount = Math.ceil(data.byteLength / CHUNK_BYTES);
  try {
    for (let index = 0; index < chunkCount; index++) {
      const offset = index * CHUNK_BYTES;
      const length = Math.min(CHUNK_BYTES, data.byteLength - offset);
      // Blobs avoid asking IndexedDB to structured-clone one 600 MB value.
      const chunk = new Blob([new Uint8Array(data, offset, length)]);
      await writeValue(db, CHUNK_STORE_NAME, chunkKey(key, index), chunk);
    }
    const metadata: ChunkedCacheMetadata = {
      format: "chunked-v1",
      byteLength: data.byteLength,
      chunkCount,
    };
    // Commit metadata last: its presence means every chunk was written.
    await writeValue(db, STORE_NAME, cacheKey(key), metadata);
  } catch (error) {
    await deleteCacheEntry(db, key);
    throw error;
  }
}

export async function delCache(key: string): Promise<void> {
  try {
    const db = await openDB();
    await deleteCacheEntry(db, key);
  } catch {
    // Cache deletion is best-effort.
  }
}

export async function clearModelCache(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction([STORE_NAME, CHUNK_STORE_NAME], "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.objectStore(CHUNK_STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

/** Ask supporting browsers not to evict the roughly 800 MB model cache. */
export function requestPersistentModelStorage(): Promise<boolean | null> {
  if (persistencePromise) return persistencePromise;
  persistencePromise = (async () => {
    try {
      if (!navigator.storage?.persist) return null;
      return await navigator.storage.persist();
    } catch {
      return null;
    }
  })();
  return persistencePromise;
}

/** Fast existence check — does NOT read the data blob */
export async function isCached(key: string): Promise<boolean> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).count(IDBKeyRange.only(cacheKey(key)));
    req.onsuccess = () => resolve(req.result > 0);
    req.onerror = () => resolve(false);
  });
}

/** Check multiple keys in a single transaction */
export async function areCached(keys: string[]): Promise<Record<string, boolean>> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const results: Record<string, boolean> = {};
    let pending = keys.length;
    if (pending === 0) { resolve(results); return; }
    for (const key of keys) {
      const req = store.count(IDBKeyRange.only(cacheKey(key)));
      req.onsuccess = () => {
        results[key] = req.result > 0;
        if (--pending === 0) resolve(results);
      };
      req.onerror = () => {
        results[key] = false;
        if (--pending === 0) resolve(results);
      };
    }
  });
}

export async function getAllCachedKeys(): Promise<string[]> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAllKeys();
    req.onsuccess = () => resolve(
      (req.result as string[])
        .filter((key) => key.startsWith(CACHE_PREFIX))
        .map((key) => key.slice(CACHE_PREFIX.length)),
    );
    req.onerror = () => resolve([]);
  });
}

/**
 * Delete cached blobs left behind by a previous MODEL_REVISION.
 *
 * Bumping MODEL_REVISION re-prefixes cache keys, so old-revision blobs
 * become invisible to the app (getAllCachedKeys filters to the current
 * prefix) yet keep occupying ~600MB–1.2GB of IndexedDB. This sweep
 * removes anything not on the current prefix so revision bumps clean up
 * after themselves without needing a DB_VERSION change. Best-effort:
 * resolves with the number of orphaned entries removed, 0 on any error.
 */
export async function pruneStaleRevisions(): Promise<number> {
  if (typeof indexedDB === "undefined") return 0;
  let db: IDBDatabase;
  try {
    db = await openDB();
  } catch {
    return 0;
  }
  return new Promise((resolve) => {
    const tx = db.transaction([STORE_NAME, CHUNK_STORE_NAME], "readwrite");
    const modelStore = tx.objectStore(STORE_NAME);
    const chunkStore = tx.objectStore(CHUNK_STORE_NAME);
    const modelReq = modelStore.getAllKeys();
    const chunkReq = chunkStore.getAllKeys();
    let staleCount = 0;
    modelReq.onsuccess = () => {
      const stale = selectStaleKeys(modelReq.result.filter(isStringKey));
      staleCount += stale.length;
      for (const key of stale) modelStore.delete(key);
    };
    chunkReq.onsuccess = () => {
      const stale = selectStaleKeys(chunkReq.result.filter(isStringKey));
      staleCount += stale.length;
      for (const key of stale) chunkStore.delete(key);
    };
    tx.oncomplete = () => resolve(staleCount);
    tx.onerror = () => resolve(0);
    tx.onabort = () => resolve(0);
  });
}

/**
 * Given every key in the store, return the ones belonging to a previous
 * model revision (safe to delete). Pure so the delete decision — the
 * part where a prefix bug could wipe live models — is unit-testable.
 */
export function selectStaleKeys(allKeys: string[]): string[] {
  return allKeys.filter((key) => !key.startsWith(CACHE_PREFIX));
}

export function isChunkedCacheMetadata(value: unknown): value is ChunkedCacheMetadata {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ChunkedCacheMetadata>;
  return (
    candidate.format === "chunked-v1" &&
    Number.isSafeInteger(candidate.byteLength) &&
    candidate.byteLength! > 0 &&
    Number.isSafeInteger(candidate.chunkCount) &&
    candidate.chunkCount! > 0 &&
    candidate.chunkCount === Math.ceil(candidate.byteLength! / CHUNK_BYTES)
  );
}

function readChunk(db: IDBDatabase, key: string): Promise<Blob | ArrayBuffer | null> {
  return new Promise((resolve) => {
    const tx = db.transaction(CHUNK_STORE_NAME, "readonly");
    const req = tx.objectStore(CHUNK_STORE_NAME).get(key);
    req.onsuccess = () => {
      const value: unknown = req.result;
      resolve(value instanceof Blob || value instanceof ArrayBuffer ? value : null);
    };
    req.onerror = () => resolve(null);
  });
}

function writeValue(
  db: IDBDatabase,
  storeName: string,
  key: string,
  value: unknown,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Model cache write failed"));
    tx.onabort = () => reject(tx.error ?? new Error("Model cache write was aborted"));
  });
}

async function deleteCacheEntry(db: IDBDatabase, key: string): Promise<void> {
  const prefix = `${cacheKey(key)}#`;
  await new Promise<void>((resolve) => {
    const tx = db.transaction([STORE_NAME, CHUNK_STORE_NAME], "readwrite");
    tx.objectStore(STORE_NAME).delete(cacheKey(key));
    const chunks = tx.objectStore(CHUNK_STORE_NAME);
    const req = chunks.getAllKeys();
    req.onsuccess = () => {
      for (const storedKey of req.result) {
        if (typeof storedKey === "string" && storedKey.startsWith(prefix)) {
          chunks.delete(storedKey);
        }
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

function cacheKey(key: string): string {
  return `${CACHE_PREFIX}${key}`;
}

function chunkKey(key: string, index: number): string {
  return `${cacheKey(key)}#${index}`;
}

function isStringKey(value: IDBValidKey): value is string {
  return typeof value === "string";
}
