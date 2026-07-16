import { describe, expect, it } from "vitest";
import { HOP, NFFT, PAD, WLEN } from "@/lib/constants";
import { istft } from "@/lib/istft";

const BINS = NFFT / 2 + 1;

describe("iSTFT invariants", () => {
  it("reconstructs a known DC spectrum across overlap-add frames", () => {
    const frames = 2;
    const magnitude = new Float32Array(BINS * frames);
    magnitude[0] = NFFT;
    magnitude[BINS] = NFFT;
    const output = istft(
      magnitude,
      new Float32Array(BINS * frames),
      new Float32Array(WLEN).fill(1),
    );

    expect(output).toHaveLength((frames - 1) * HOP + WLEN - 2 * PAD);
    expect(Array.from(output).every((sample) => Number.isFinite(sample))).toBe(true);
    expect(Array.from(output).every((sample) => Math.abs(sample - 1) < 1e-6)).toBe(true);
  });

  it("returns exact zeros for a zero spectrum", () => {
    expect(istft(
      new Float32Array(BINS),
      new Float32Array(BINS),
      new Float32Array(WLEN).fill(1),
    )).toEqual(new Float32Array(WLEN - 2 * PAD));
  });

  it("rejects malformed shapes and non-finite inputs", () => {
    const spectrum = new Float32Array(BINS);
    const phase = new Float32Array(BINS);
    const window = new Float32Array(WLEN).fill(1);
    expect(() => istft(new Float32Array(), new Float32Array(), window)).toThrow(RangeError);
    expect(() => istft(spectrum, new Float32Array(BINS - 1), window)).toThrow(RangeError);
    expect(() => istft(new Float32Array(BINS + 1), new Float32Array(BINS + 1), window)).toThrow(RangeError);
    expect(() => istft(spectrum, phase, new Float32Array(WLEN - 1))).toThrow(RangeError);
    spectrum[0] = Number.NaN;
    expect(() => istft(spectrum, phase, window)).toThrow("finite");
  });
});
