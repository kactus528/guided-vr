/** Minimal promise wrapper around IndexedDB. Data is local to this browser profile and is NOT encrypted. */

const DB_NAME = 'gvr-db';
const DB_VERSION = 1;

export type StoreName = 'sessions' | 'recordings' | 'narration';

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('recordings')) {
        const r = db.createObjectStore('recordings', { keyPath: 'id' });
        r.createIndex('sessionId', 'sessionId');
      }
      // Narration segments for the Voice Studio (Milestone 2): key = `${profile}:${segment}`.
      if (!db.objectStoreNames.contains('narration')) db.createObjectStore('narration', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function put<T>(store: StoreName, value: T): Promise<void> {
  const db = await open();
  await wrap(db.transaction(store, 'readwrite').objectStore(store).put(value));
}

export async function get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const db = await open();
  return (await wrap(db.transaction(store).objectStore(store).get(key))) as T | undefined;
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await open();
  return (await wrap(db.transaction(store).objectStore(store).getAll())) as T[];
}

export async function getAllBy<T>(store: StoreName, index: string, key: IDBValidKey): Promise<T[]> {
  const db = await open();
  return (await wrap(db.transaction(store).objectStore(store).index(index).getAll(key))) as T[];
}

export async function del(store: StoreName, key: IDBValidKey): Promise<void> {
  const db = await open();
  await wrap(db.transaction(store, 'readwrite').objectStore(store).delete(key));
}

export async function clear(store: StoreName): Promise<void> {
  const db = await open();
  await wrap(db.transaction(store, 'readwrite').objectStore(store).clear());
}

export function uid(prefix: string): string {
  const r = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}_${Date.now().toString(36)}_${r[0].toString(36)}${r[1].toString(36)}`;
}
