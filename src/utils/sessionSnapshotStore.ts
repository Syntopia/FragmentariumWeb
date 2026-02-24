export interface SessionSnapshotRecord {
  path: string;
  pngBlob: Blob;
  updatedAtMs: number;
}

interface SessionSnapshotDbRecord extends SessionSnapshotRecord {}

const DB_NAME = "fragmentarium-web-session-snapshots-v1";
const DB_VERSION = 1;
const STORE_NAME = "sessionSnapshots";

function getIndexedDbOrThrow(): IDBFactory {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is unavailable in this browser context.");
  }
  return indexedDB;
}

function openSessionSnapshotDb(): Promise<IDBDatabase> {
  const idb = getIndexedDbOrThrow();
  return new Promise((resolve, reject) => {
    const request = idb.open(DB_NAME, DB_VERSION);
    request.onerror = () => {
      reject(request.error ?? new Error("Failed to open IndexedDB session snapshot database."));
    };
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "path" });
        store.createIndex("updatedAtMs", "updatedAtMs", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, tx: IDBTransaction) => Promise<T> | T
): Promise<T> {
  return new Promise((resolve, reject) => {
    void (async () => {
      let db: IDBDatabase | null = null;
      let settled = false;
      try {
        db = await openSessionSnapshotDb();
        const database = db;
        const tx = database.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        let runResolved = false;
        let txCompleted = mode === "readonly";
        let runResult: T | undefined;

        const cleanup = (): void => {
          database.close();
        };

        const tryResolve = (): void => {
          if (settled || !runResolved || !txCompleted) {
            return;
          }
          settled = true;
          cleanup();
          resolve(runResult as T);
        };

        tx.onabort = () => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          reject(tx.error ?? new Error("IndexedDB transaction aborted."));
        };
        tx.onerror = () => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          reject(tx.error ?? new Error("IndexedDB transaction failed."));
        };
        tx.oncomplete = () => {
          txCompleted = true;
          tryResolve();
        };

        runResult = await run(store, tx);
        runResolved = true;
        tryResolve();
      } catch (error) {
        if (!settled) {
          settled = true;
          db?.close();
        }
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });
}

function idbRequestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
    request.onsuccess = () => resolve(request.result);
  });
}

export async function listSessionSnapshotRecords(): Promise<SessionSnapshotRecord[]> {
  return await withStore("readonly", async (store) => {
    const all = await idbRequestToPromise(store.getAll() as IDBRequest<SessionSnapshotDbRecord[]>);
    return [...all]
      .filter(
        (record) =>
          typeof record.path === "string" &&
          record.path.trim().length > 0 &&
          typeof record.updatedAtMs === "number" &&
          Number.isFinite(record.updatedAtMs) &&
          record.pngBlob instanceof Blob
      )
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((record) => ({
        path: record.path,
        pngBlob: record.pngBlob,
        updatedAtMs: record.updatedAtMs
      }));
  });
}

export async function putSessionSnapshotRecord(record: SessionSnapshotRecord): Promise<void> {
  if (record.path.trim().length === 0) {
    throw new Error("Session snapshot path cannot be empty.");
  }
  if (!(record.pngBlob instanceof Blob)) {
    throw new Error("Session snapshot PNG must be a Blob.");
  }
  if (!Number.isFinite(record.updatedAtMs)) {
    throw new Error("Session snapshot updatedAtMs must be finite.");
  }

  await withStore("readwrite", (store) => {
    store.put({
      path: record.path,
      pngBlob: record.pngBlob,
      updatedAtMs: record.updatedAtMs
    } satisfies SessionSnapshotDbRecord);
  });
}

export async function deleteSessionSnapshotRecord(path: string): Promise<void> {
  if (path.trim().length === 0) {
    throw new Error("Session snapshot path cannot be empty.");
  }
  await withStore("readwrite", (store) => {
    store.delete(path);
  });
}

export async function clearSessionSnapshotRecords(): Promise<void> {
  await withStore("readwrite", (store) => {
    store.clear();
  });
}
