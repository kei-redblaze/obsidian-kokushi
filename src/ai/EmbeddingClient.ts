import { deleteCachedModels } from "./ModelCache";
import { MODEL_REVISION } from "./model";

export type Backend = "webgpu" | "wasm";
type Initialize = { kind: "initialize"; download: boolean; backend: Backend };
type Encode = { kind: "encode"; texts: string[] };
export type WorkerRequest = { id: number } & (Initialize | Encode);
export type WorkerReply = {
  id: number;
  error?: string;
  progress?: { complete: number; total: number };
  vectors?: Float32Array[];
};
type Progress = (complete: number, total: number) => void;

export interface EmbeddingModel {
  readonly isReady: boolean;
  readonly backend?: Backend;
  useWebGPU?(value: boolean): void;
  onBackendChange?(listener: () => void): () => void;
  remove?(): Promise<void>;
  prepare(progress: Progress): Promise<void>;
  encode(texts: string[]): Promise<Float32Array[]>;
  close(): void;
}

const READY = `kokushi.model.${MODEL_REVISION}`;

export class EmbeddingClient implements EmbeddingModel {
  private worker?: Worker;
  private objectUrl?: string;
  private sequence = 0;
  private ready = this.readReady();
  private activeBackend?: Backend;
  private preferWebGPU = false;
  private failedWebGPU = false;
  private closed = false;
  private queue: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  private pending = new Map<number, {
    resolve: (vectors: Float32Array[]) => void;
    reject: (error: Error) => void;
    progress?: Progress;
    timer?: number;
  }>();

  get isReady(): boolean { return this.ready; }
  get backend(): Backend | undefined { return this.activeBackend; }

  useWebGPU(value: boolean): void {
    if (value === this.preferWebGPU) return;
    this.preferWebGPU = value;
    this.failedWebGPU = false;
    if (this.worker) {
      void this.enqueue(() => {
        if (this.activeBackend && this.activeBackend !== (this.preferWebGPU ? "webgpu" : "wasm")) {
          this.reset(new Error("Embedding backend changed"));
        }
        return Promise.resolve();
      }).catch(() => {});
    }
  }

  onBackendChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  prepare(progress: Progress): Promise<void> {
    return this.enqueue(async () => {
      try {
        await this.initializeWithFallback(true, progress);
        this.setReady(true);
      } catch (error) {
        this.setReady(false);
        throw error;
      }
    });
  }

  encode(texts: string[]): Promise<Float32Array[]> {
    if (!texts.length) return Promise.resolve([]);
    return this.enqueue(async () => {
      if (!this.ready) throw new Error("Local model is not ready");
      try {
        await this.initializeWithFallback(false);
      } catch (error) {
        this.setReady(false);
        throw error;
      }
      const startedOnGPU = this.activeBackend === "webgpu";
      try {
        return await this.send({ kind: "encode", texts }, undefined, startedOnGPU);
      } catch (error) {
        if (!startedOnGPU || this.closed) throw error;
        this.failedWebGPU = true;
        await this.initialize(false, "wasm");
        return this.send({ kind: "encode", texts });
      }
    });
  }

  remove(): Promise<void> {
    return this.enqueue(async () => {
      this.reset(new Error("Embedding worker reset"));
      await deleteCachedModels();
      this.setReady(false);
      this.failedWebGPU = false;
    });
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
    this.reset(new Error("Embedding worker closed"));
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.queue.then(() => {
      if (this.closed) throw new Error("Embedding worker closed");
      return operation();
    });
    this.queue = task.then(() => {}, () => {});
    return task;
  }

  private readReady(): boolean {
    try { return window.localStorage.getItem(READY) === "1"; } catch { return false; }
  }

  private setReady(value: boolean): void {
    this.ready = value;
    try {
      if (value) window.localStorage.setItem(READY, "1");
      else window.localStorage.removeItem(READY);
    } catch { /* optional readiness marker */ }
  }

  private async initializeWithFallback(download: boolean, progress?: Progress): Promise<void> {
    const backend = this.preferWebGPU && !this.failedWebGPU ? "webgpu" : "wasm";
    try {
      await this.initialize(download, backend, progress);
    } catch (error) {
      if (backend !== "webgpu" || this.closed) throw error;
      this.failedWebGPU = true;
      await this.initialize(download, "wasm", progress);
    }
  }

  private async initialize(download: boolean, backend: Backend, progress?: Progress): Promise<void> {
    if (this.activeBackend === backend) return;
    this.reset(new Error("Embedding worker reset"));
    try {
      await this.createWorker();
      await this.send({ kind: "initialize", download, backend }, progress, backend === "webgpu");
      this.activeBackend = backend;
      this.listeners.forEach(listener => listener());
    } catch (error) {
      this.reset(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private async createWorker(): Promise<void> {
    const { default: code } = await import("kokushi:embedding-worker");
    if (this.closed) throw new Error("Embedding worker closed");
    this.objectUrl = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    const worker = new Worker(this.objectUrl, { type: "module" });
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const { id, error, progress, vectors } = event.data;
      if (id === 0 && error) {
        this.reset(new Error(error));
        return;
      }
      const pending = this.pending.get(id);
      if (!pending) return;
      if (progress) {
        pending.progress?.(progress.complete, progress.total);
        return;
      }
      this.pending.delete(id);
      window.clearTimeout(pending.timer);
      if (error) pending.reject(new Error(error));
      else pending.resolve(vectors ?? []);
    };
    worker.onerror = event => this.reset(new Error(event.message || "Embedding worker could not start"));
    worker.onmessageerror = () => this.reset(new Error("Embedding worker response could not be read"));
  }

  private send(request: Initialize | Encode, progress?: Progress, gpu = false): Promise<Float32Array[]> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error("Embedding worker is unavailable"));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      // Explicit downloads can legitimately take longer than GPU initialization.
      const timer = gpu && (request.kind !== "initialize" || !request.download)
        ? window.setTimeout(() => this.reset(new Error("WebGPU request timed out")), 30000) : undefined;
      this.pending.set(id, { resolve, reject, progress, timer });
      try { worker.postMessage({ id, ...request }); }
      catch (error) {
        window.clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private reset(error: Error): void {
    const hadBackend = this.activeBackend !== undefined;
    this.activeBackend = undefined;
    this.worker?.terminate();
    this.worker = undefined;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = undefined;
    this.pending.forEach(request => {
      window.clearTimeout(request.timer);
      request.reject(error);
    });
    this.pending.clear();
    if (hadBackend) this.listeners.forEach(listener => listener());
  }
}
