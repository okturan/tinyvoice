import { describe, expect, it } from "vitest";
import { trimLeadingSilence } from "../src/lib/audio/trim";

const SR = 16000;

function signal(silenceSec: number, speechSec: number, amplitude = 0.3): Float32Array {
  const out = new Float32Array(Math.round((silenceSec + speechSec) * SR));
  const speechStart = Math.round(silenceSec * SR);
  for (let i = speechStart; i < out.length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * 220 * (i - speechStart)) / SR);
  }
  return out;
}

describe("trimLeadingSilence", () => {
  it("cuts leading silence down to the pre-roll", () => {
    const audio = signal(2, 1);
    const trimmed = trimLeadingSilence(audio, SR);
    const expected = 1 * SR + 0.12 * SR;
    expect(trimmed.length).toBeGreaterThanOrEqual(expected - 0.02 * SR);
    expect(trimmed.length).toBeLessThanOrEqual(expected + 0.02 * SR);
  });

  it("keeps immediate speech untouched", () => {
    const audio = signal(0, 1);
    expect(trimLeadingSilence(audio, SR)).toBe(audio);
  });

  it("leaves an all-silent recording alone", () => {
    const audio = new Float32Array(SR);
    expect(trimLeadingSilence(audio, SR)).toBe(audio);
  });

  it("ignores low-level noise below the threshold", () => {
    const audio = signal(1, 1);
    for (let i = 0; i < SR; i++) audio[i] = 0.004 * Math.sin((2 * Math.PI * 100 * i) / SR);
    const trimmed = trimLeadingSilence(audio, SR);
    expect(trimmed.length).toBeLessThan(audio.length);
  });
});
