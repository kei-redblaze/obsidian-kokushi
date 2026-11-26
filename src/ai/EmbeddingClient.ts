import { MODEL_REVISION } from "./model";

type Initialize = { kind: "initialize"; download: boolean };
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
  prepare(progress: Progress): Promise<void>;
  encode(texts: string[]): Promise<Float32Array[]>;
  close(): void;
}

const READY = `kokushi.model.${MODEL_REVISION}`;

export class EmbeddingClient implements EmbeddingModel {
  private worker?: Worker;
  private objectUrl?: string;
  private starting?: Promise<void>;
  private sequence = 0;
  private initialized = false;
  private ready = this.readReady();
  private closed = false;
  private pending = new Map<number, {
    resolve: (vectors: Float32Array[]) => void;
    reject: (error: Error) => void;
    progress?: Progress;
  }>();

  get isReady(): boolean { return this.ready; }

  async prepare(progress: Progress): Promise<void> {
    await this.initialize(true, progress);
    this.ready = true;
    try {
      window.localStorage.setItem(READY, "1");
    } catch (error) {
      console.warn("[Kokushi] Model readiness could not be stored", error);
    }
  }

  async encode(texts: string[]): Promise<Float32Array[]> {
    if (!texts.length) return [];
    if (!this.ready) throw new Error("Local model is not ready");
    await this.initialize(false);
    return this.send({ kind: "encode", texts });
  }

  close(): void {
    this.closed = true;
    this.reset(new Error("Embedding worker closed"));
  }

  private readReady(): boolean {
    try { return window.localStorage.getItem(READY) === "1"; } catch { return false; }
  }

  private async initialize(download: boolean, progress?: Progress): Promise<void> {
    if (this.closed) throw new Error("Embedding worker closed");
    if (this.initialized) return;
    if (this.starting) {
      try { await this.starting; } catch (error) { if (!download) throw error; }
      if (this.initialized) return;
    }
    const task = (async () => {
      try {
        await this.createWorker();
        await this.send({ kind: "initialize", download }, progress);
        this.initialized = true;
      } catch (error) {
        this.ready = false;
        try { window.localStorage.removeItem(READY); } catch { /* optional readiness marker */ }
        this.reset(error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    })();
    this.starting = task;
    try { await task; } finally { if (this.starting === task) this.starting = undefined; }
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
      if (error) pending.reject(new Error(error));
      else pending.resolve(vectors ?? []);
    };
    worker.onerror = event => this.reset(new Error(event.message || "Embedding worker could not start"));
    worker.onmessageerror = () => this.reset(new Error("Embedding worker response could not be read"));
  }

  private send(request: Initialize | Encode, progress?: Progress): Promise<Float32Array[]> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error("Embedding worker is unavailable"));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, progress });
      try { worker.postMessage({ id, ...request }); }
      catch (error) { this.pending.delete(id); reject(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  private reset(error: Error): void {
    this.initialized = false;
    this.worker?.terminate();
    this.worker = undefined;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = undefined;
    this.pending.forEach(request => request.reject(error));
    this.pending.clear();
  }
}
