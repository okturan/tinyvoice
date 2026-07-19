import { describe, expect, it } from "vitest";
import { trimLeadingSilence } from "../src/lib/audio/trim";

const SR = 16000;

function tone(seconds: number, amplitude: number, freq = 220): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / SR);
  }
  return out;
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

describe("trimLeadingSilence", () => {
  it("cuts leading digital silence down to the pre-roll", () => {
    const audio = concat(new Float32Array(2 * SR), tone(1, 0.3));
    const trimmed = trimLeadingSilence(audio, SR);
    const expected = 1 * SR + 0.1 * SR;
    expect(trimmed.length).toBeGreaterThanOrEqual(expected - 0.03 * SR);
    expect(trimmed.length).toBeLessThanOrEqual(expected + 0.03 * SR);
  });

  it("cuts a short lead-in before a long take", () => {
    // 0.4s of silence before 3s of speech: the silent windows are only
    // ~12% of the clip, so a floor sampled at the 25th percentile would
    // land inside speech and inflate the threshold past it (the
    // "still some silentish lead-in" bug). The 10th percentile stays in
    // the silence.
    const audio = concat(new Float32Array(Math.round(0.4 * SR)), tone(3, 0.3));
    const trimmed = trimLeadingSilence(audio, SR);
    const expected = 3 * SR + 0.1 * SR;
    expect(trimmed.length).toBeGreaterThanOrEqual(expected - 0.03 * SR);
    expect(trimmed.length).toBeLessThanOrEqual(expected + 0.03 * SR);
  });

  it("cuts 'silentish' lead-in room tone above the fixed floor", () => {
    // Room tone at 0.05 amplitude would fool a fixed 0.015 gate; the
    // adaptive gate keys off the recording's own noise floor.
    const audio = concat(tone(1.5, 0.05, 90), tone(1, 0.5));
    const trimmed = trimLeadingSilence(audio, SR);
    const expected = 1 * SR + 0.1 * SR;
    expect(trimmed.length).toBeGreaterThanOrEqual(expected - 0.05 * SR);
    expect(trimmed.length).toBeLessThanOrEqual(expected + 0.05 * SR);
  });

  it("keeps immediate speech untouched", () => {
    const audio = tone(1, 0.3);
    expect(trimLeadingSilence(audio, SR)).toBe(audio);
  });

  it("leaves an all-silent recording alone", () => {
    const audio = new Float32Array(SR);
    expect(trimLeadingSilence(audio, SR)).toBe(audio);
  });

  it("leaves steady room tone with no speech alone", () => {
    const audio = tone(2, 0.03, 90);
    expect(trimLeadingSilence(audio, SR)).toBe(audio);
  });

  it("ignores quiet noise below the minimum threshold", () => {
    const audio = concat(tone(1, 0.004, 100), tone(1, 0.3));
    const trimmed = trimLeadingSilence(audio, SR);
    expect(trimmed.length).toBeLessThan(audio.length);
  });
});
