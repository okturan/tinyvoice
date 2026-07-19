/**
 * Cut the dead silence before speech starts.
 *
 * The gate is noise-floor adaptive: a fixed threshold lets "silentish"
 * room tone through, so instead we estimate the recording's own floor
 * (10th-percentile window RMS — low enough that even a sub-second
 * lead-in before a long take still samples the silence, not the speech)
 * and require windows to clear max(minThreshold, floorMultiplier × floor)
 * for a few consecutive windows before calling it speech. A short
 * pre-roll is kept so the attack isn't clipped.
 */
export function trimLeadingSilence(
  samples: Float32Array,
  sampleRate: number,
  {
    minThreshold = 0.012,
    floorMultiplier = 4,
    windowSec = 0.01,
    preRollSec = 0.1,
    sustainWindows = 3,
  } = {},
): Float32Array {
  const windowSize = Math.max(1, Math.round(windowSec * sampleRate));
  const windowCount = Math.floor(samples.length / windowSize);
  if (windowCount < sustainWindows) return samples;

  const rms = new Float64Array(windowCount);
  for (let w = 0; w < windowCount; w++) {
    const start = w * windowSize;
    let sum = 0;
    for (let i = start; i < start + windowSize; i++) sum += samples[i] * samples[i];
    rms[w] = Math.sqrt(sum / windowSize);
  }

  const sorted = Float64Array.from(rms).sort();
  const noiseFloor = sorted[Math.floor(sorted.length * 0.1)];
  const threshold = Math.max(minThreshold, noiseFloor * floorMultiplier);

  let firstVoiced = -1;
  for (let w = 0; w + sustainWindows <= windowCount; w++) {
    let sustained = true;
    for (let k = 0; k < sustainWindows; k++) {
      if (rms[w + k] < threshold) {
        sustained = false;
        break;
      }
    }
    if (sustained) {
      firstVoiced = w * windowSize;
      break;
    }
  }

  // Nothing voiced, or speech from the very start: leave the recording alone.
  if (firstVoiced <= 0) return samples;

  const cut = Math.max(0, firstVoiced - Math.round(preRollSec * sampleRate));
  if (cut === 0) return samples;
  return samples.subarray(cut);
}
