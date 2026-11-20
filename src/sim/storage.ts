import { openDB, type IDBPDatabase } from 'idb';
import type { BatchRunState, LayoutSpec, Package, PackageGenConfig } from './types';

const DB_NAME = 'barcode-camera-sim';
const DB_VERSION = 1;
const STORE = {
  packages: 'packages',
  configs: 'packageConfigs',
  layouts: 'layouts',
  runs: 'runs',
} as const;

interface SimDB {
  packages: Package;
  packageConfigs: PackageGenConfig;
  layouts: LayoutSpec;
  runs: BatchRunState;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE.configs)) db.createObjectStore(STORE.configs, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORE.layouts)) db.createObjectStore(STORE.layouts, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORE.runs)) db.createObjectStore(STORE.runs, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORE.packages)) db.createObjectStore(STORE.packages, { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
}

export async function idbPut<T extends object>(store: keyof SimDB, value: T & { id?: string | number }): Promise<void> {
  const db = await getDb();
  await db.put(store, value);
}

export async function idbGet<T>(store: keyof SimDB, key: string | number): Promise<T | undefined> {
  const db = await getDb();
  return db.get(store, key) as Promise<T | undefined>;
}

export async function idbGetAll<T>(store: keyof SimDB): Promise<T[]> {
  const db = await getDb();
  return db.getAll(store) as Promise<T[]>;
}

export async function idbDelete(store: keyof SimDB, key: string | number): Promise<void> {
  const db = await getDb();
  await db.delete(store, key);
}

export async function idbClear(store: keyof SimDB): Promise<void> {
  const db = await getDb();
  await db.clear(store);
}

/** 包裹样本可能上万条，按固定 chunk 分批提交事务，避免单事务过大 */
export async function idbPutPackages(packages: Package[], chunkSize = 500): Promise<void> {
  const db = await getDb();
  for (let start = 0; start < packages.length; start += chunkSize) {
    const chunk = packages.slice(start, start + chunkSize);
    const tx = db.transaction(STORE.packages, 'readwrite');
    await Promise.all(chunk.map((pkg) => tx.store.put(pkg)));
    await tx.done;
  }
}

export async function idbCountPackages(): Promise<number> {
  const db = await getDb();
  return db.count(STORE.packages);
}

export { STORE };
