// Browser-Speicher (IndexedDB) für die Arbeitskopie der Datenbank. Bleibt ausschließlich auf diesem Gerät.

const IDB_NAME = 'vereinsverwaltung';
const STORE = 'files';
const KEY = 'main';

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const idb = await openIdb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = idb.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result as T);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    idb.close();
  }
}

export async function loadFromBrowser(): Promise<Uint8Array | null> {
  try {
    const v = await withStore<ArrayBuffer | Uint8Array | undefined>('readonly', (s) => s.get(KEY));
    if (!v) return null;
    return v instanceof Uint8Array ? v : new Uint8Array(v);
  } catch {
    return null;
  }
}

export async function saveToBrowser(bytes: Uint8Array): Promise<void> {
  await withStore('readwrite', (s) => s.put(bytes, KEY));
}

export async function clearBrowser(): Promise<void> {
  await withStore('readwrite', (s) => s.delete(KEY));
}

/** Bittet den Browser, den Speicher nicht automatisch zu leeren. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export function downloadBlob(data: BlobPart, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
