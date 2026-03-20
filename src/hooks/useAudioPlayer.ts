import { useCallback } from "react";
import { playAudio } from "@/lib/audio/playback";

export function useAudioPlayer() {
  const play = useCallback(async (samples: Float32Array) => {
    await playAudio(samples);
  }, []);

  return { play };
}
