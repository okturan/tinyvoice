import { beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({
  getCached: vi.fn(),
  setCache: vi.fn(),
  delCache: vi.fn(),
}));

const { TEST_MODEL_BYTES } = vi.hoisted(() => ({ TEST_MODEL_BYTES: 1024 * 1024 }));

vi.mock("@/lib/model-cache", () => cache);
vi.mock("@/lib/constants", () => ({
  MODEL_BASE: "https://huggingface.co/skymorphosis/focalcodec-onnx/resolve/a683dc2f143f129c30becb04ffef95cbd52f9eb7/",
  MODEL_ARTIFACT_BYTES: { "encoder.onnx": TEST_MODEL_BYTES },
}));

import {
  MAX_MODEL_BYTES,
  loadModel,
  modelUrl,
  parseContentLength,
} from "@/lib/model-loader";

const ONE_MIB = TEST_MODEL_BYTES;

function streamedResponse(chunks: Uint8Array[], contentLength?: number): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(stream, {
    headers: contentLength === undefined
      ? undefined
      : { "Content-Length": String(contentLength) },
  });
}

describe("model URL and response bounds", () => {
  it("builds a same-directory URL for a safe ONNX filename", () => {
    expect(modelUrl("decoder_12_5hz.onnx")).toBe(
      "https://huggingface.co/skymorphosis/focalcodec-onnx/resolve/a683dc2f143f129c30becb04ffef95cbd52f9eb7/decoder_12_5hz.onnx",
    );
  });

  it.each(["../model.onnx", "folder/model.onnx", "model.bin", "?model.onnx", "model..onnx"])(
    "rejects unsafe model filename %s",
    (name) => expect(() => modelUrl(name)).toThrow("Invalid model filename"),
  );

  it("parses only safe integer content lengths within model bounds", () => {
    expect(parseContentLength(null)).toBeUndefined();
    expect(parseContentLength(String(ONE_MIB))).toBe(ONE_MIB);
    expect(() => parseContentLength("1.5")).toThrow("invalid Content-Length");
    expect(() => parseContentLength("100")).toThrow("outside the accepted range");
    expect(() => parseContentLength(String(MAX_MODEL_BYTES + 1))).toThrow("outside the accepted range");
  });
});

describe("model loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.getCached.mockResolvedValue(null);
    cache.setCache.mockResolvedValue(undefined);
    cache.delCache.mockResolvedValue(undefined);
  });

  it("returns a bounded cache hit without touching the network", async () => {
    const cached = new ArrayBuffer(ONE_MIB);
    cache.getCached.mockResolvedValue(cached);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadModel("encoder.onnx", vi.fn())).resolves.toBe(cached);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("streams an exact-length response and caches the complete model", async () => {
    const first = new Uint8Array(ONE_MIB / 2).fill(1);
    const second = new Uint8Array(ONE_MIB / 2).fill(2);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      streamedResponse([first, second], ONE_MIB),
    ));
    const progress = vi.fn();

    const result = await loadModel("encoder.onnx", progress);
    expect(result.byteLength).toBe(ONE_MIB);
    expect(new Uint8Array(result)[0]).toBe(1);
    expect(new Uint8Array(result)[ONE_MIB - 1]).toBe(2);
    expect(cache.setCache).toHaveBeenCalledOnce();
    expect(cache.setCache).toHaveBeenCalledWith("encoder.onnx", result);
    expect(progress).toHaveBeenCalled();
  });

  it("rejects truncated bodies with and without a declared length", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      streamedResponse([new Uint8Array(32)], ONE_MIB),
    ));
    await expect(loadModel("encoder.onnx", vi.fn())).rejects.toThrow("expected 1048576 bytes");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      streamedResponse([new Uint8Array(32)]),
    ));
    await expect(loadModel("encoder.onnx", vi.fn())).rejects.toThrow("expected 1048576 bytes");
  });

  it("rejects a response length that differs from the pinned artifact manifest", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      streamedResponse([new Uint8Array(ONE_MIB)], ONE_MIB + 1),
    ));
    await expect(loadModel("encoder.onnx", vi.fn())).rejects.toThrow("server declared 1048577");
  });

  it("rejects HTTP errors, missing bodies, and pre-aborted requests", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("no", { status: 404 })));
    await expect(loadModel("encoder.onnx", vi.fn())).rejects.toThrow("HTTP 404");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null)));
    await expect(loadModel("encoder.onnx", vi.fn())).rejects.toThrow("no response body");

    const controller = new AbortController();
    controller.abort();
    await expect(loadModel("encoder.onnx", vi.fn(), controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("refuses safe-looking filenames that are absent from the pinned manifest", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadModel("unknown.onnx", vi.fn())).rejects.toThrow("pinned artifact manifest");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
