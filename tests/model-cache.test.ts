import { describe, expect, it } from "vitest";
import { selectStaleKeys } from "@/lib/model-cache";
import { MODEL_REVISION } from "@/lib/constants";

const PREFIX = `${MODEL_REVISION}:`;

describe("selectStaleKeys", () => {
  it("keeps current-revision keys and marks every other revision stale", () => {
    const keys = [
      `${PREFIX}encoder.onnx`,
      `${PREFIX}compressor_25hz.onnx`,
      "oldrevisionhash:encoder.onnx",
      "oldrevisionhash:compressor_50hz.onnx",
    ];
    expect(selectStaleKeys(keys)).toEqual([
      "oldrevisionhash:encoder.onnx",
      "oldrevisionhash:compressor_50hz.onnx",
    ]);
  });

  it("treats legacy unprefixed keys as stale", () => {
    // Keys written before the revision-prefix scheme existed.
    expect(selectStaleKeys(["encoder.onnx", "decoder_12_5hz.onnx"])).toEqual([
      "encoder.onnx",
      "decoder_12_5hz.onnx",
    ]);
  });

  it("returns nothing when everything is on the current revision", () => {
    expect(selectStaleKeys([`${PREFIX}encoder.onnx`, `${PREFIX}decoder_50hz.onnx`])).toEqual([]);
  });

  it("handles an empty store", () => {
    expect(selectStaleKeys([])).toEqual([]);
  });
});
