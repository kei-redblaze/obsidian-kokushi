import { env, pipeline, FeatureExtractionPipeline } from "@huggingface/transformers";
import runtimeSource from "kokushi:onnx-module";
import runtimeBytes from "kokushi:onnx-wasm";
import { MODEL, MODEL_FILES, MODEL_REVISION, MODEL_URL } from "./model";
import { openModelCache } from "./ModelCache";
import type { WorkerRequest, WorkerReply } from "./EmbeddingClient";

const runtime = env.backends.onnx.wasm;
if (!runtime) throw new Error("WebAssembly runtime unavailable");
const loader = URL.createObjectURL(new Blob([runtimeSource], { type: "text/javascript" }));
const binary = URL.createObjectURL(new Blob([runtimeBytes], { type: "application/wasm" }));
runtime.wasmPaths = { mjs: loader, wasm: binary };
runtime.numThreads = 1;
runtime.proxy = false;
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
env.useFSCache = false;
env.useCustomCache = true;

let extractor: FeatureExtractionPipeline | undefined;

async function initialize(download: boolean, progress: (complete: number, total: number) => void): Promise<void> {
  if (extractor) return;
  const cache = await openModelCache();
  for (const [index, file] of MODEL_FILES.entries()) {
    if (!await cache.read(file)) {
      if (!download) throw new Error("Model is missing from the device cache");
      const response = await self.fetch(new URL(file, MODEL_URL), { credentials: "omit" });
      if (!response.ok) throw new Error(`Model download failed (${response.status})`);
      await cache.write(file, await response.blob());
    }
    progress(index + 1, MODEL_FILES.length);
  }

  env.customCache = {
    async match(request: string) {
      if (!request.startsWith(MODEL_URL)) return undefined;
      const blob = await cache.read(request.slice(MODEL_URL.length));
      return blob ? new Response(blob) : undefined;
    },
    async put() { throw new Error("Model access is read-only during inference"); },
  };
  try {
    extractor = await pipeline<"feature-extraction">("feature-extraction", MODEL, {
      revision: MODEL_REVISION, dtype: "q8", device: "wasm", local_files_only: true,
    });
  } finally {
    URL.revokeObjectURL(loader);
    URL.revokeObjectURL(binary);
  }
}

self.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
  event.preventDefault();
  const error: unknown = event.reason;
  self.postMessage({ id: 0, error: error instanceof Error ? error.message : String(error) });
});

let queue = Promise.resolve();
self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const send = (reply: Omit<WorkerReply, "id">): void => { self.postMessage({ id: request.id, ...reply }); };
  queue = queue.then(async () => {
    try {
      if (request.kind === "initialize") {
        await initialize(request.download, (complete, total) => send({ progress: { complete, total } }));
        send({ vectors: [] });
      } else {
        if (!extractor) throw new Error("Model is not initialized");
        const tensor = await extractor(request.texts, { pooling: "mean", normalize: true });
        const size = tensor.dims[1] ?? 0;
        if (!size) throw new Error("Embedding output is empty");
        const data = Float32Array.from(tensor.data as Float32Array);
        tensor.dispose();
        const vectors = request.texts.map((_, index) => data.slice(index * size, (index + 1) * size));
        self.postMessage({ id: request.id, vectors }, { transfer: vectors.map(vector => vector.buffer) });
      }
    } catch (error) {
      send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
});
