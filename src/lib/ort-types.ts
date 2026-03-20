/**
 * Minimal type declarations for ONNX Runtime Web.
 * ORT is loaded from CDN and accessed via `window.ort`.
 */

export interface OrtTensor {
  data: Float32Array | BigInt64Array | Int32Array;
  dims: number[];
}

export interface OrtInferenceSession {
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
}

export interface OrtStatic {
  InferenceSession: {
    create(
      buffer: ArrayBuffer,
      options?: { executionProviders: string[] }
    ): Promise<OrtInferenceSession>;
  };
  Tensor: new (
    type: string,
    data: Float32Array | BigInt64Array | Int32Array | number[],
    dims: number[]
  ) => OrtTensor;
}

declare global {
  interface Window {
    ort: OrtStatic;
  }
}

export function getOrt(): OrtStatic {
  return window.ort;
}
