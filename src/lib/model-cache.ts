import { MODEL_REVISION } from "@/lib/constants";

const DB_NAME = "focalcodec-models";
const STORE_NAME = "models";
const DB_VERSION = 2;
const CACHE_PREFIX = `${MODEL_REVISION}:`;

let dbPromise: Promise<IDBDatabase> | null = null;

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
      } else {
        req.transaction?.objectStore(STORE_NAME).clear();
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
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(cacheKey(key));
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

export async function setCache(key: string, data: ArrayBuffer): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(data, cacheKey(key));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function delCache(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(cacheKey(key));
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function clearModelCache(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
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

function cacheKey(key: string): string {
  return `${CACHE_PREFIX}${key}`;
}
