import { useState, useRef, useCallback } from "react";
import { SR } from "@/lib/constants";
import { getWorkletUrl } from "@/lib/audio/recorder-worklet";

interface RecorderState {
  isRecording: boolean;
  duration: number;
  analyserNode: AnalyserNode | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Float32Array | null;
}

export function useAudioRecorder(): RecorderState {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);

  const chunksRef = useRef<Float32Array[]>([]);
  const actxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const mediaSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const workletRegisteredRef = useRef(false);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);

  const startRecording = useCallback(async () => {
    chunksRef.current = [];

    // Get mic if we don't have one
    if (!micStreamRef.current) {
      micStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: SR, channelCount: 1 },
      });
    }

    // Create AudioContext if needed
    if (!actxRef.current || actxRef.current.state === "closed") {
      actxRef.current = new AudioContext({ sampleRate: SR });
      workletRegisteredRef.current = false;
    }
    const actx = actxRef.current;
    if (actx.state === "suspended") await actx.resume();

    // Register worklet (only once per AudioContext)
    if (!workletRegisteredRef.current) {
      const url = getWorkletUrl();
      await actx.audioWorklet.addModule(url);
      workletRegisteredRef.current = true;
    }

    // Create nodes
    const source = actx.createMediaStreamSource(micStreamRef.current);
    mediaSourceRef.current = source;

    const worklet = new AudioWorkletNode(actx, "recorder-processor");
    workletNodeRef.current = worklet;
    worklet.port.onmessage = (e: MessageEvent) => {
      if (e.data.type === "samples") {
        chunksRef.current.push(new Float32Array(e.data.data));
      }
    };

    // Analyser for waveform
    const analyser = actx.createAnalyser();
    analyser.fftSize = 256;
    analyserRef.current = analyser;
    setAnalyserNode(analyser);

    // Connect: source -> worklet -> destination (silent)
    //          source -> analyser (for visuals)
    source.connect(worklet);
    worklet.connect(actx.destination);
    source.connect(analyser);

    // Start recording
    worklet.port.postMessage({ type: "start" });

    // Timer
    startTimeRef.current = Date.now();
    setDuration(0);
    timerRef.current = setInterval(() => {
      setDuration((Date.now() - startTimeRef.current) / 1000);
    }, 100);

    setIsRecording(true);
  }, []);

  const stopRecording = useCallback((): Float32Array | null => {
    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Stop worklet
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage({ type: "stop" });
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }

    // Disconnect source
    if (mediaSourceRef.current) {
      mediaSourceRef.current.disconnect();
      mediaSourceRef.current = null;
    }

    setIsRecording(false);
    setAnalyserNode(null);
    analyserRef.current = null;

    // Concatenate chunks
    const chunks = chunksRef.current;
    if (chunks.length === 0) return null;

    const totalLength = chunks.reduce((s, c) => s + c.length, 0);
    if (totalLength < SR * 0.15) return null; // too short

    const audio = new Float32Array(totalLength);
    let offset = 0;
    for (const c of chunks) {
      audio.set(c, offset);
      offset += c.length;
    }

    chunksRef.current = [];
    return audio;
  }, []);

  return {
    isRecording,
    duration,
    analyserNode,
    startRecording,
    stopRecording,
  };
}
