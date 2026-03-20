const DB_NAME = "focalcodec-models";
const STORE_NAME = "models";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
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

export async function setCache(key: string, data: ArrayBuffer): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(data, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function delCache(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
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
    const req = tx.objectStore(STORE_NAME).count(IDBKeyRange.only(key));
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
      const req = store.count(IDBKeyRange.only(key));
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
    req.onsuccess = () => resolve(req.result as string[]);
    req.onerror = () => resolve([]);
  });
}

export async function getCachedSize(key: string): Promise<number> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => {
      const data = req.result as ArrayBuffer | undefined;
      resolve(data ? data.byteLength : 0);
    };
    req.onerror = () => resolve(0);
  });
}

export async function getTotalCacheSize(): Promise<{ keys: string[]; totalBytes: number }> {
  const keys = await getAllCachedKeys();
  let totalBytes = 0;
  for (const key of keys) {
    totalBytes += await getCachedSize(key);
  }
  return { keys, totalBytes };
}
