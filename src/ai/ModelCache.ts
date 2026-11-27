import { MODEL_REVISION } from "./model";

export async function openModelCache(): Promise<ModelCache> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("kokushi-local-model", 1);
    request.onupgradeneeded = () => { request.result.createObjectStore("files"); };
    request.onsuccess = () => { resolve(new ModelCache(request.result)); };
    request.onerror = () => { reject(request.error ?? new Error("Model cache is unavailable")); };
  });
}

export async function deleteCachedModels(): Promise<void> {
  const cache = await openModelCache();
  try {
    await cache.clear();
  } finally {
    cache.close();
  }
}

class ModelCache {
  constructor(private db: IDBDatabase) {}

  async read(file: string): Promise<Blob | undefined> {
    return new Promise((resolve, reject) => {
      const request = this.db.transaction("files").objectStore("files").get(this.key(file));
      request.onsuccess = () => { resolve(request.result instanceof Blob ? request.result : undefined); };
      request.onerror = () => { reject(request.error ?? new Error("Model cache is unavailable")); };
    });
  }

  async write(file: string, contents: Blob): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction("files", "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => { reject(transaction.error ?? new Error("Model cache write was aborted")); };
      transaction.objectStore("files").put(contents, this.key(file));
    });
  }

  async clear(): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction("files", "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error("Could not clear the model cache"));
      transaction.objectStore("files").clear();
    });
  }

  close(): void { this.db.close(); }

  private key(file: string): string {
    return `${MODEL_REVISION}/${file}`;
  }
}
