import { SR } from "@/lib/constants";

let playCtx: AudioContext | null = null;

function getPlayCtx(): AudioContext {
  if (!playCtx) {
    playCtx = new AudioContext({ sampleRate: SR });
  }
  return playCtx;
}

/** Play a Float32Array of audio samples at SR sample rate. */
export async function playAudio(samples: Float32Array): Promise<void> {
  const ctx = getPlayCtx();
  if (ctx.state === "suspended") await ctx.resume();
  const buf = ctx.createBuffer(1, samples.length, SR);
  buf.getChannelData(0).set(samples);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
}
