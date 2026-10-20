/**
 * Where the connector's SharedWorker keeps its node cache (node-cache.ts): a
 * small IndexedDB database of its own, since a worker has no localStorage.
 * One that can't be opened (a private window, a browser that refuses it)
 * leaves the cache in the worker's memory, which lasts while any tab is open.
 */
import type { NodeCache, NodeStore } from './node-cache.js';

export function idbNodeStore(name = 'wordplus-realtime', key = 'nodes', idb: IDBFactory | undefined = (globalThis as { indexedDB?: IDBFactory }).indexedDB): NodeStore {
    let opened: Promise<IDBDatabase | null> | null = null;

    const open = (): Promise<IDBDatabase | null> => opened ??= new Promise((resolve) => {
        if (!idb) {
            resolve(null);
            return;
        }
        try {
            const request = idb.open(name, 1);
            request.onupgradeneeded = () => request.result.createObjectStore('kv');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
            request.onblocked = () => resolve(null);
        } catch {
            resolve(null);
        }
    });

    return {
        read: async () => {
            const db = await open();
            if (!db) return null;
            return new Promise<unknown>((resolve) => {
                try {
                    const request = db.transaction('kv').objectStore('kv').get(key);
                    request.onsuccess = () => resolve(request.result ?? null);
                    request.onerror = () => resolve(null);
                } catch {
                    resolve(null);
                }
            });
        },
        write: async (cache: NodeCache | null) => {
            const db = await open();
            if (!db) return;
            await new Promise<void>((resolve) => {
                try {
                    const tx = db.transaction('kv', 'readwrite');
                    const store = tx.objectStore('kv');
                    if (cache) store.put(cache, key);
                    else store.delete(key);
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => resolve();
                    tx.onabort = () => resolve();
                } catch {
                    resolve();
                }
            });
        },
    };
}
