/**
 * ONNX Runtime Web — loaded via CDN script tag in index.html.
 * Declares the global `ort` namespace so TypeScript can access it.
 */

declare namespace ort {
  class Tensor {
    constructor(
      type: string,
      data: Float32Array | BigInt64Array | Int32Array | Uint8Array,
      dims: readonly number[],
    );
    readonly data: Float32Array | BigInt64Array;
    readonly dims: readonly number[];
    readonly type: string;
  }

  interface RunResult {
    [key: string]: Tensor;
  }

  interface SessionCreateOptions {
    executionProviders?: string[];
  }

  class InferenceSession {
    static create(
      buffer: ArrayBuffer | Uint8Array,
      options?: SessionCreateOptions,
    ): Promise<InferenceSession>;
    run(feeds: Record<string, Tensor>): Promise<RunResult>;
  }
}

interface Window {
  ort: typeof ort;
}
