declare module "kokushi:embedding-worker" {
  const source: string;
  export default source;
}
declare module "kokushi:onnx-module" {
  const source: string;
  export default source;
}
declare module "kokushi:onnx-wasm" {
  const bytes: Uint8Array<ArrayBuffer>;
  export default bytes;
}

declare module "*.yaml" {
  const definitions: {
    revision: string;
    entries: readonly { id: string; name: string; terms: readonly string[] }[];
  };
  export default definitions;
}
