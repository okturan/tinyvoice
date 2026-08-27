/**
 * E2E override of `@/lib/constants` (see vite.e2e.config.ts).
 *
 * Everything is re-exported verbatim except MODEL_ARTIFACT_BYTES: the real
 * loader refuses bodies whose length differs from the pinned manifest, and it
 * refuses anything under 1 MiB, so every fake model is exactly 1 MiB.
 */
export * from "../../src/lib/constants";

export const E2E_MODEL_BYTES = 1024 * 1024;

export const MODEL_ARTIFACT_BYTES: Readonly<Record<string, number>> = {
  "encoder.onnx": E2E_MODEL_BYTES,
  "compressor_50hz.onnx": E2E_MODEL_BYTES,
  "decoder_50hz.onnx": E2E_MODEL_BYTES,
  "compressor_25hz.onnx": E2E_MODEL_BYTES,
  "decoder_25hz.onnx": E2E_MODEL_BYTES,
  "compressor_12_5hz.onnx": E2E_MODEL_BYTES,
  "decoder_12_5hz.onnx": E2E_MODEL_BYTES,
};
