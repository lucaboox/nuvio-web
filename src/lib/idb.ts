/**
 * The browser's answer to `platform.storage`.
 *
 * Reached through the capability rather than by name, so that the same UI runs
 * over a shell that writes files instead. The one exception is the auth
 * Worker, which holds the session and calls in here directly: it is web-only
 * for as long as the two clients keep their own auth, and a Worker has no
 * business importing a capability layer built around a shell it cannot see.
 */
const DB_NAME = "nuvio-web";
const STORE = "key-value";
let databasePromise: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        databasePromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(request.error);
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(new Error("Nuvio web storage is blocked by another tab."));
    };
  });
  return databasePromise;
}

export async function getValue<T>(key: string): Promise<T | null> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(key);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function setValue<T>(key: string, value: T): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteValue(key: string): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
