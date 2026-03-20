/// <reference types="vite/client" />

interface OrtTensor {
  data: Float32Array | BigInt64Array;
  dims: number[];
}

interface OrtRunResult {
  [key: string]: OrtTensor;
}

interface OrtInferenceSession {
  run(feeds: Record<string, unknown>): Promise<OrtRunResult>;
}

interface OrtNamespace {
  InferenceSession: {
    create(
      model: ArrayBuffer,
      options?: { executionProviders: string[] },
    ): Promise<OrtInferenceSession>;
  };
  Tensor: new (
    type: string,
    data: Float32Array | BigInt64Array,
    dims: number[],
  ) => unknown;
}

declare const ort: OrtNamespace;
