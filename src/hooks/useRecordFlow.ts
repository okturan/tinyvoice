import { useState, useRef, useCallback, useEffect } from "react";
import { useCodecContext } from "@/contexts/CodecContext";
import { codec as codecService } from "@/lib/codec-service";
import { areCached } from "@/lib/model-cache";
import { Quality } from "@/types/codec";
import { QUALITY_OPTIONS, SR } from "@/lib/constants";
import { getWorkletUrl } from "@/lib/audio/recorder-worklet";
import { trimLeadingSilence } from "@/lib/audio/trim";
import {
  getMicDeviceId,
  getMicGain,
  getTrimSilence,
  setTrimSilence,
} from "@/lib/mic-settings";
import { qualityLabel } from "@/lib/format";

export type RecordState = "idle" | "recording" | "encoding";

export interface EncodeResult {
  packed: Uint8Array;
  tokenCount: number;
  duration: number;
}

/**
 * All state and behavior behind the QR Record flow: quality/cache
 * bookkeeping, mic + worklet recording, waveform drawing, and encoding.
 * Layouts compose the returned pieces however they like.
 */
export function useRecordFlow() {
  const codecContext = useCodecContext();
  const [quality, setQuality] = useState<Quality>(Quality.Hz12_5);
  const [recordState, setRecordState] = useState<RecordState>("idle");
  const [cacheState, setCacheState] = useState<"unknown" | "all" | "partial" | "none">("unknown");
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [encodeProgress, setEncodeProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState<"" | "ok" | "err">("");
  const [encodeResult, setEncodeResult] = useState<EncodeResult | null>(null);

  // Hex sheet state
  const [hexOpen, setHexOpen] = useState(false);
  const [hexData, setHexData] = useState<Uint8Array | null>(null);

  // Pre-speech silence trim (persisted, defaults on)
  const [trimEnabled, setTrimEnabledState] = useState(getTrimSilence);
  const setTrimEnabled = useCallback((enabled: boolean) => {
    setTrimEnabledState(enabled);
    setTrimSilence(enabled);
  }, []);

  // Recording refs
  const micRef = useRef<MediaStream | null>(null);
  const actxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const mediaSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const isRecRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const waveRafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [recTime, setRecTime] = useState("0.0s");
  const recStartRef = useRef(0);
  const workletRegisteredRef = useRef(false);
  const autoPickedQualityRef = useRef(false);
  const userPickedQualityRef = useRef(false);
  const modelsLoaded = codecContext.isQualityLoaded(quality);
  const readyToRecord = modelsLoaded && audioReady;
  const loadingModels = !modelsLoaded && codecContext.state === "loading";
  const displayStatus = loadingModels ? codecContext.statusText : status;
  const displayStatusType = loadingModels ? "" : statusType;
  const loadedStatus = `${qualityLabel(quality)} loaded`;
  const showDisplayStatus = Boolean(displayStatus && (!modelsLoaded || displayStatus !== loadedStatus));

  const resetResult = useCallback(() => {
    setEncodeResult(null);
    setHexData(null);
    setEncodeProgress(0);
    setStatusType("");
    setStatus(loadedStatus);
  }, [loadedStatus]);

  /**
   * Get (or refresh) the mic stream, honoring the preferred input device.
   * Re-acquires when the saved device differs from the live track's.
   */
  const ensureMicStream = useCallback(async (): Promise<MediaStream> => {
    const preferred = getMicDeviceId();
    const current = micRef.current;
    if (current) {
      const track = current.getAudioTracks()[0];
      const active = track?.readyState === "live";
      const sameDevice = !preferred || track?.getSettings().deviceId === preferred;
      if (active && sameDevice) return current;
      for (const t of current.getTracks()) t.stop();
      micRef.current = null;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: SR,
        channelCount: 1,
        ...(preferred ? { deviceId: { ideal: preferred } } : {}),
      },
    });
    micRef.current = stream;
    return stream;
  }, []);

  const handleQualityChange = useCallback((next: Quality) => {
    userPickedQualityRef.current = true;
    setEncodeResult(null);
    setHexData(null);
    setEncodeProgress(0);
    setQuality(next);
  }, []);

  useEffect(() => {
    if (autoPickedQualityRef.current || userPickedQualityRef.current) return;

    const loaded = codecContext.loadedQualities[0];
    if (loaded && loaded !== quality) {
      autoPickedQualityRef.current = true;
      setQuality(loaded);
      setStatus(`${qualityLabel(loaded)} loaded`);
      return;
    }

    const keys = [
      "encoder.onnx",
      ...QUALITY_OPTIONS.map((option) => `compressor_${option.value}.onnx`),
    ];
    areCached(keys).then((results) => {
      if (autoPickedQualityRef.current || userPickedQualityRef.current) return;
      const cached = QUALITY_OPTIONS.find(
        (option) => results["encoder.onnx"] && results[`compressor_${option.value}.onnx`],
      );
      if (cached && cached.value !== quality) {
        autoPickedQualityRef.current = true;
        setQuality(cached.value);
        setStatus(`${qualityLabel(cached.value)} loaded`);
      }
    });
  }, [codecContext.loadedQualities, quality]);

  // Check which models are cached when quality changes
  useEffect(() => {
    if (modelsLoaded) {
      setCacheState("all");
      setStatus(loadedStatus);
      return;
    }
    const encKey = "encoder.onnx";
    const compKey = `compressor_${quality}.onnx`;
    areCached([encKey, compKey]).then((results) => {
      const enc = results[encKey];
      const comp = results[compKey];
      if (enc && comp) {
        setCacheState("all");
        setStatus("Cached models available");
      } else if (enc || comp) {
        setCacheState("partial");
        setStatus(enc ? `${qualityLabel(quality)} compressor needs download` : "Encoder needs download");
      } else {
        setCacheState("none");
        setStatus("");
      }
    });
  }, [quality, modelsLoaded, loadedStatus]);

  // Waveform drawing
  const drawWaveform = useCallback(() => {
    if (!isRecRef.current) return;
    waveRafRef.current = requestAnimationFrame(drawWaveform);
    const analyser = analyserRef.current;
    const canvas = canvasRef.current;
    if (!analyser || !canvas) return;

    const bufLen = analyser.frequencyBinCount;
    const dataArr = new Uint8Array(bufLen);
    analyser.getByteTimeDomainData(dataArr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 1.5;
    const style = getComputedStyle(document.documentElement);
    ctx.strokeStyle = style.getPropertyValue("--red").trim() || "#f38ba8";
    ctx.beginPath();
    const sliceW = w / bufLen;
    let x = 0;
    for (let i = 0; i < bufLen; i++) {
      const v = dataArr[i] / 128.0;
      const y = v * (h / 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += sliceW;
    }
    ctx.stroke();
  }, []);

  const handleLoadModels = useCallback(async () => {
    try {
      setStatusType("");
      setStatus("Loading models...");
      const loaded = await codecContext.loadModels(quality);
      if (!loaded) {
        setStatus("Download cancelled");
        return;
      }

      if (!micRef.current) {
        setStatus("Requesting microphone...");
        await ensureMicStream();
      }
      if (!actxRef.current || actxRef.current.state === "closed") {
        actxRef.current = new AudioContext({ sampleRate: SR });
        workletRegisteredRef.current = false;
      }
      setAudioReady(true);
      setStatusType("ok");
      setStatus(`${qualityLabel(quality)} loaded`);
    } catch (e) {
      setStatusType("err");
      setStatus((e as Error).message);
    }
  }, [codecContext, quality, ensureMicStream]);

  const recDown = useCallback(
    async (e: React.PointerEvent) => {
      e.preventDefault();
      if (!readyToRecord || isRecRef.current) return;

      isRecRef.current = true;
      chunksRef.current = [];
      setEncodeResult(null);
      setHexData(null);
      setEncodeProgress(0);
      setRecordState("recording");
      setStatus("Recording...");
      setStatusType("");

      const actx = actxRef.current!;
      if (actx.state === "suspended") await actx.resume();

      // Register worklet (only once per AudioContext)
      if (!workletRegisteredRef.current) {
        const url = getWorkletUrl();
        await actx.audioWorklet.addModule(url);
        workletRegisteredRef.current = true;
      }

      const mic = await ensureMicStream();
      const source = actx.createMediaStreamSource(mic);
      mediaSourceRef.current = source;

      const gain = actx.createGain();
      gain.gain.value = getMicGain();
      gainNodeRef.current = gain;

      const worklet = new AudioWorkletNode(actx, "recorder-processor");
      workletNodeRef.current = worklet;
      worklet.port.onmessage = (ev: MessageEvent) => {
        if (ev.data.type === "samples") {
          chunksRef.current.push(new Float32Array(ev.data.data));
        }
      };

      source.connect(gain);
      gain.connect(worklet);
      worklet.connect(actx.destination);

      // Start recording
      worklet.port.postMessage({ type: "start" });

      // Waveform + timer (post-gain, so the meter shows what gets encoded)
      const analyser = actx.createAnalyser();
      analyser.fftSize = 256;
      gain.connect(analyser);
      analyserRef.current = analyser;
      recStartRef.current = Date.now();
      setRecTime("0.0s");
      timerRef.current = setInterval(() => {
        setRecTime(
          ((Date.now() - recStartRef.current) / 1000).toFixed(1) + "s",
        );
      }, 100);
      drawWaveform();
    },
    [readyToRecord, drawWaveform, ensureMicStream],
  );

  const recUp = useCallback(
    async (e?: React.PointerEvent) => {
      if (e) e.preventDefault();
      if (!isRecRef.current) return;
      isRecRef.current = false;

      // Stop visuals
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (waveRafRef.current) {
        cancelAnimationFrame(waveRafRef.current);
        waveRafRef.current = null;
      }

      // Stop and disconnect worklet
      if (workletNodeRef.current) {
        workletNodeRef.current.port.postMessage({ type: "stop" });
        workletNodeRef.current.disconnect();
        workletNodeRef.current = null;
      }

      // Disconnect source + gain
      if (mediaSourceRef.current) {
        mediaSourceRef.current.disconnect();
        mediaSourceRef.current = null;
      }
      if (gainNodeRef.current) {
        gainNodeRef.current.disconnect();
        gainNodeRef.current = null;
      }

      analyserRef.current = null;

      setRecordState("encoding");

      // Force UI update before heavy WASM work
      await new Promise((r) => setTimeout(r, 50));

      const tl = chunksRef.current.reduce((s, c) => s + c.length, 0);
      const assembled = new Float32Array(tl);
      let off = 0;
      for (const c of chunksRef.current) {
        assembled.set(c, off);
        off += c.length;
      }

      const audio = trimEnabled ? trimLeadingSilence(assembled, SR) : assembled;
      if (audio.length < 4096) {
        setStatusType("err");
        setStatus("Too short — hold longer");
        setRecordState("idle");
        return;
      }

      try {
        const result = await codecService.encode(audio, quality, (info) => {
          setEncodeProgress(info.fraction * 100);
          setStatus(info.status);
        });

        setHexData(result.packed);
        setEncodeResult(result);
        // The result view shows the outcome; don't leave a stale
        // "QR ready" line behind in the codec card.
        setStatusType("");
        setStatus(`${qualityLabel(quality)} loaded`);
      } catch (e) {
        setStatusType("err");
        setStatus((e as Error).message);
      }

      setRecordState("idle");
    },
    [quality, trimEnabled],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (waveRafRef.current) cancelAnimationFrame(waveRafRef.current);
      if (workletNodeRef.current) {
        workletNodeRef.current.port.postMessage({ type: "stop" });
        workletNodeRef.current.disconnect();
      }
      if (mediaSourceRef.current) mediaSourceRef.current.disconnect();
    };
  }, []);

  return {
    codecContext,
    quality,
    recordState,
    cacheState,
    downloadOpen,
    setDownloadOpen,
    audioReady,
    encodeProgress,
    encodeResult,
    hexOpen,
    setHexOpen,
    hexData,
    canvasRef,
    recTime,
    modelsLoaded,
    readyToRecord,
    loadingModels,
    displayStatus,
    displayStatusType,
    loadedStatus,
    showDisplayStatus,
    handleQualityChange,
    handleLoadModels,
    recDown,
    recUp,
    resetResult,
    trimEnabled,
    setTrimEnabled,
  };
}

export type RecordFlow = ReturnType<typeof useRecordFlow>;
