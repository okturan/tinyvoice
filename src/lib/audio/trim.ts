/**
 * Cut the dead silence before speech starts. Scans forward in short
 * windows for the first one whose RMS clears the threshold, then keeps a
 * small pre-roll before it so the attack isn't clipped.
 */
export function trimLeadingSilence(
  samples: Float32Array,
  sampleRate: number,
  { threshold = 0.015, windowSec = 0.01, preRollSec = 0.12 } = {},
): Float32Array {
  const windowSize = Math.max(1, Math.round(windowSec * sampleRate));
  let firstVoiced = -1;

  for (let start = 0; start < samples.length; start += windowSize) {
    const end = Math.min(samples.length, start + windowSize);
    let sum = 0;
    for (let i = start; i < end; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / (end - start));
    if (rms >= threshold) {
      firstVoiced = start;
      break;
    }
  }

  // All silence: leave the recording alone rather than returning nothing.
  if (firstVoiced <= 0) return samples;

  const cut = Math.max(0, firstVoiced - Math.round(preRollSec * sampleRate));
  if (cut === 0) return samples;
  return samples.subarray(cut);
}
