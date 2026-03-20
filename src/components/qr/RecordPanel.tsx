import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import QualityPicker from "./QualityPicker";
import QRResult from "./QRResult";
import HexSheet from "./HexSheet";
import { codec } from "@/lib/codec-service";
import { isCached } from "@/lib/model-cache";
import { Quality } from "@/types/codec";
import { SR } from "@/lib/constants";
import { getWorkletUrl } from "@/lib/audio/recorder-worklet";

type RecordState = "idle" | "recording" | "encoding";

export default function RecordPanel() {
  const [quality, setQuality] = useState<Quality>(Quality.Hz12_5);
  const [recordState, setRecordState] = useState<RecordState>("idle");
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [cacheState, setCacheState] = useState<"unknown" | "all" | "partial" | "none">("unknown");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState<"" | "ok" | "err">("");
  const [encodeResult, setEncodeResult] = useState<{
    packed: Uint8Array;
    tokenCount: number;
    duration: number;
  } | null>(null);

  // Hex sheet state
  const [hexOpen, setHexOpen] = useState(false);
  const [hexData, setHexData] = useState<Uint8Array | null>(null);

  // Recording refs
  const micRef = useRef<MediaStream | null>(null);
  const actxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
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

  // Check which models are cached when quality changes
  useEffect(() => {
    if (modelsLoaded) return;
    Promise.all([
      isCached("encoder.onnx"),
      isCached(`compressor_${quality}.onnx`),
    ]).then(([enc, comp]) => {
      if (enc && comp) {
        setCacheState("all");
        setStatus("Ready to initialize");
      } else if (enc || comp) {
        setCacheState("partial");
        setStatus(enc ? `${quality} compressor needs download` : "Encoder needs download");
      } else {
        setCacheState("none");
        setStatus("");
      }
    });
  }, [quality, modelsLoaded]);

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
      setLoading(true);
      setStatus("Requesting microphone...");
      setStatusType("");
      micRef.current = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: SR, channelCount: 1 },
      });
      actxRef.current = new AudioContext({ sampleRate: SR });

      await codec.loadEncoder((info) => {
        setProgress(info.fraction * 72);
        setStatus(info.status);
      });

      await codec.loadCompressor(quality, (info) => {
        setProgress(72 + info.fraction * 20);
        setStatus(info.status);
      });

      setProgress(100);
      setStatusType("ok");
      setStatus(`Ready (${quality}) \u2014 hold to record`);
      setModelsLoaded(true);
    } catch (e) {
      setStatusType("err");
      setStatus((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [quality]);

  const recDown = useCallback(
    async (e: React.PointerEvent) => {
      e.preventDefault();
      if (!modelsLoaded || isRecRef.current) return;

      isRecRef.current = true;
      chunksRef.current = [];
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

      const mic = micRef.current!;
      const source = actx.createMediaStreamSource(mic);
      mediaSourceRef.current = source;

      const worklet = new AudioWorkletNode(actx, "recorder-processor");
      workletNodeRef.current = worklet;
      worklet.port.onmessage = (ev: MessageEvent) => {
        if (ev.data.type === "samples") {
          chunksRef.current.push(new Float32Array(ev.data.data));
        }
      };

      source.connect(worklet);
      worklet.connect(actx.destination);

      // Start recording
      worklet.port.postMessage({ type: "start" });

      // Waveform + timer
      const analyser = actx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
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
    [modelsLoaded, drawWaveform],
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

      // Disconnect source
      if (mediaSourceRef.current) {
        mediaSourceRef.current.disconnect();
        mediaSourceRef.current = null;
      }

      analyserRef.current = null;

      setRecordState("encoding");

      // Force UI update before heavy WASM work
      await new Promise((r) => setTimeout(r, 50));

      const tl = chunksRef.current.reduce((s, c) => s + c.length, 0);
      if (tl < 4096) {
        setStatusType("err");
        setStatus("Too short \u2014 hold longer");
        setRecordState("idle");
        return;
      }

      const audio = new Float32Array(tl);
      let off = 0;
      for (const c of chunksRef.current) {
        audio.set(c, off);
        off += c.length;
      }

      try {
        const result = await codec.encode(audio, quality, (info) => {
          setProgress(info.fraction * 100);
          setStatus(info.status);
        });

        setHexData(result.packed);
        setEncodeResult(result);
        setStatusType("ok");
        setStatus(
          `${result.duration.toFixed(1)}s \u2192 ${result.packed.length} bytes \u2192 QR ready`,
        );
      } catch (e) {
        setStatusType("err");
        setStatus((e as Error).message);
      }

      setRecordState("idle");
    },
    [quality],
  );

  const resetRecord = useCallback(() => {
    setEncodeResult(null);
    setHexData(null);
    setHexOpen(false);
    setProgress(0);
    setStatusType("ok");
    setStatus("Ready \u2014 hold to record");
  }, []);

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

  return (
    <div className="flex flex-col gap-4">
      {/* Quality Picker Card */}
      <Card className="border-[var(--surface0)] bg-[var(--mantle)] py-0">
        <CardContent className="py-3 px-4">
          <div className="text-[0.6rem] text-[var(--overlay)] uppercase tracking-widest font-semibold mb-2">
            Quality
          </div>
          <QualityPicker value={quality} onChange={setQuality} refreshKey={modelsLoaded ? 1 : 0} />
        </CardContent>
      </Card>

      {/* Codec Status Card */}
      <Card className="border-[var(--surface0)] bg-[var(--mantle)] py-0">
        <CardContent className="py-3 px-4">
          <div className="text-[0.6rem] text-[var(--overlay)] uppercase tracking-widest font-semibold mb-2">
            Codec
          </div>
          {!modelsLoaded ? (
            <div className="space-y-2">
              <Button
                className="w-full"
                onClick={handleLoadModels}
                disabled={loading}
              >
                {loading
                  ? "Initializing..."
                  : cacheState === "all"
                    ? "Initialize Models"
                    : cacheState === "partial"
                      ? "Download & Initialize"
                      : "Download Models"}
              </Button>
              {(loading || progress > 0) && (
                <Progress value={progress} className="h-1.5" />
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="size-2 rounded-full bg-[var(--green)]" />
                <span className="text-xs text-[var(--green)]">
                  Models loaded ({quality})
                </span>
              </div>
              {progress > 0 && progress < 100 && (
                <Progress value={progress} className="h-1.5" />
              )}
            </div>
          )}
          <p
            className={`mt-2 min-h-[1.2em] text-[0.7rem] ${
              statusType === "ok"
                ? "text-[var(--green)]"
                : statusType === "err"
                  ? "text-[var(--red)]"
                  : "text-[var(--overlay)]"
            }`}
          >
            {status}
          </p>
        </CardContent>
      </Card>

      {/* Record Button */}
      <div className="flex flex-col items-center py-4">
        <button
          className={`mb-3 flex h-[100px] w-[100px] cursor-pointer select-none flex-col items-center justify-center gap-1 rounded-full border-2 font-sans text-xs font-semibold transition-all ${
            !modelsLoaded
              ? "cursor-not-allowed border-[var(--surface1)] bg-[var(--mantle)] text-[var(--overlay)] opacity-15"
              : recordState === "recording"
                ? "border-[var(--red)] bg-[color-mix(in_srgb,var(--red)_8%,var(--base))] text-[var(--red)]"
                : recordState === "encoding"
                  ? "animate-pulse border-[var(--yellow)] text-[var(--yellow)]"
                  : "border-[var(--surface1)] bg-[var(--mantle)] text-[var(--overlay)] hover:border-[var(--surface2)] hover:bg-[var(--surface0)] hover:text-[var(--subtext)]"
          }`}
          onPointerDown={recDown}
          onPointerUp={recUp}
          onPointerLeave={recUp}
          disabled={!modelsLoaded}
        >
          {recordState === "encoding" ? (
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  from="0 12 12"
                  to="360 12 12"
                  dur="1s"
                  repeatCount="indefinite"
                />
              </path>
            </svg>
          ) : (
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
          )}
          <span>{recordState === "encoding" ? "ENCODING" : "HOLD"}</span>
        </button>

        {/* Waveform + timer */}
        <div
          className={`flex h-8 items-center justify-center gap-2.5 ${
            recordState === "recording" ? "" : "hidden"
          }`}
        >
          <canvas ref={canvasRef} className="h-8 w-40 rounded-md" width={200} height={32} />
          <span className="min-w-[3em] font-mono text-sm font-semibold tabular-nums text-[var(--red)]">
            {recTime}
          </span>
        </div>

        {recordState !== "recording" && (
          <p className="text-[0.65rem] text-[var(--overlay)] opacity-60">
            hold to record · release to encode
          </p>
        )}

        {/* Encode progress (only during encode) */}
        {recordState === "encoding" && (
          <Progress value={progress} className="mt-2 h-1 w-40" />
        )}
      </div>

      {/* QR Result Card */}
      {encodeResult && (
        <Card className="border-[var(--surface0)] bg-[var(--mantle)] py-0">
          <CardContent className="py-4 px-4">
            <QRResult
              packed={encodeResult.packed}
              duration={encodeResult.duration}
              onHexOpen={() => setHexOpen(true)}
            />
            <div className="mt-3 text-center">
              <Button variant="outline" size="sm" onClick={resetRecord}>
                Record another
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Hex Sheet */}
      <HexSheet
        data={hexData}
        open={hexOpen}
        onOpenChange={setHexOpen}
      />
    </div>
  );
}
