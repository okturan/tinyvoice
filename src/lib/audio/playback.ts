import { SR } from "@/lib/constants";

let playCtx: AudioContext | null = null;

function getPlayCtx(): AudioContext {
  if (!playCtx) {
    playCtx = new AudioContext({ sampleRate: SR });
  }
  return playCtx;
}

/**
 * Play a Float32Array of audio samples at SR sample rate.
 * Resolves when playback ends.
 */
export async function playAudio(
  samples: Float32Array,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;

  const ctx = getPlayCtx();
  if (ctx.state === "suspended") await ctx.resume();
  if (signal?.aborted) return;

  const buf = ctx.createBuffer(1, samples.length, SR);
  buf.getChannelData(0).set(samples);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", handleAbort);
      src.onended = null;
      src.disconnect();
      resolve();
    };

    const handleAbort = () => {
      src.onended = null;
      try {
        src.stop();
      } catch {
        // The source may not have started or may already have ended.
      }
      finish();
    };

    src.onended = finish;
    signal?.addEventListener("abort", handleAbort, { once: true });

    if (signal?.aborted) {
      handleAbort();
      return;
    }

    try {
      src.start();
    } catch (error) {
      settled = true;
      signal?.removeEventListener("abort", handleAbort);
      src.onended = null;
      src.disconnect();
      reject(error);
    }
  });
}
