import { useCallback, useEffect, useRef } from "react";
import { playAudio } from "@/lib/audio/playback";

export function useAudioPlayer() {
  const controllerRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const play = useCallback(async (samples: Float32Array) => {
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    try {
      await playAudio(samples, controller.signal);
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  return { play, stop };
}
