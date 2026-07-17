import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import HexSheet from "./HexSheet";
import { useCodecContext } from "@/contexts/CodecContext";
import { codec, type ParsedPacket } from "@/lib/codec-service";
import { Quality } from "@/types/codec";
import { SR } from "@/lib/constants";
import { autoDecoderLabel, qualityLabel } from "@/lib/format";
import CodeIcon from "@/components/ui/code-icon";
import { HexStream } from "@/components/audio/HexStream";

const QUALITY_BTNS: { label: string; value: string }[] = [
  { label: "Auto", value: "auto" },
  { label: "12.5hz", value: Quality.Hz12_5 },
  { label: "25hz", value: Quality.Hz25 },
  { label: "50hz", value: Quality.Hz50 },
];

interface DecodePlayerProps {
  parsed: ParsedPacket;
  packetBytes: Uint8Array;
}

export default function DecodePlayer({
  parsed,
  packetBytes,
}: DecodePlayerProps) {
  const codecContext = useCodecContext();
  const [qualityOverride, setQualityOverride] = useState<Quality | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState<"" | "ok" | "err">("");
  const [hexOpen, setHexOpen] = useState(false);

  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const playbackGenerationRef = useRef(0);

  const tokenCount = parsed.tokenBytes.length / 2;
  const effectiveQuality = qualityOverride || parsed.quality;
  const qualityReady = codecContext.isQualityLoaded(effectiveQuality);
  const loadingModels = !qualityReady && codecContext.state === "loading";
  const effectiveQualityLabel = qualityLabel(effectiveQuality);
  const estDuration = codec.estimateDuration(tokenCount, effectiveQuality);
  const autoLabel = autoDecoderLabel(parsed.quality, parsed.hasMagicByte);

  const initialStatus = `${packetBytes.length}B, ${tokenCount} tok, ~${estDuration.toFixed(1)}s \u00b7 ${qualityLabel(parsed.quality)}${parsed.hasMagicByte ? "" : " (legacy fallback)"}`;

  const stopPlayback = useCallback(() => {
    const source = sourceRef.current;
    if (!source) return;
    sourceRef.current = null;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // The source may already have ended.
    }
    source.disconnect();
  }, []);

  useEffect(() => {
    playbackGenerationRef.current += 1;
    stopPlayback();
    audioBufferRef.current = null;
    setIsPlaying(false);
    setIsLoading(false);
    setProgress(0);
    setStatus("");
    setStatusType("");

    return () => {
      playbackGenerationRef.current += 1;
      stopPlayback();
    };
  }, [packetBytes, stopPlayback]);

  useEffect(() => {
    return () => {
      const context = playCtxRef.current;
      playCtxRef.current = null;
      if (context && context.state !== "closed") void context.close();
    };
  }, []);

  const handleQualityChange = useCallback(
    (q: string) => {
      const newQ = q === "auto" ? null : (q as Quality);
      playbackGenerationRef.current += 1;
      stopPlayback();
      setQualityOverride(newQ);
      audioBufferRef.current = null;
      setIsPlaying(false);
      setIsLoading(false);
      setProgress(0);
      setStatus(
        `Decoder set to ${newQ ? qualityLabel(newQ) : autoLabel}`,
      );
      setStatusType("");
    },
    [autoLabel, stopPlayback],
  );

  const handlePlay = useCallback(async () => {
    if (sourceRef.current) {
      playbackGenerationRef.current += 1;
      stopPlayback();
      setIsPlaying(false);
      return;
    }

    const generation = ++playbackGenerationRef.current;
    const isCurrent = () => playbackGenerationRef.current === generation;
    const cachedBuffer = audioBufferRef.current;

    try {
      if (cachedBuffer) {
        if (!playCtxRef.current || playCtxRef.current.state === "closed") {
          playCtxRef.current = new AudioContext({ sampleRate: SR });
        }
        if (playCtxRef.current.state === "suspended") {
          await playCtxRef.current.resume();
        }
        if (!isCurrent()) return;

        const src = playCtxRef.current.createBufferSource();
        src.buffer = cachedBuffer;
        src.connect(playCtxRef.current.destination);
        sourceRef.current = src;
        setIsPlaying(true);
        src.onended = () => {
          src.disconnect();
          if (!isCurrent() || sourceRef.current !== src) return;
          sourceRef.current = null;
          setIsPlaying(false);
        };
        src.start();
        return;
      }

      const q = effectiveQuality;
      if (!codecContext.isQualityLoaded(q)) {
        setStatusType("");
        setStatus(`Downloading ${effectiveQualityLabel} models...`);
        const ok = await codecContext.loadModels(q);
        if (!isCurrent()) return;
        if (!ok) {
          setStatus("Download cancelled");
          return;
        }
      }

      setIsLoading(true);
      const audio = await codec.decodeTokens(
        parsed.tokenBytes,
        tokenCount,
        q,
        (info) => {
          if (!isCurrent()) return;
          setProgress(info.fraction * 100);
          setStatus(info.status);
          setStatusType("");
        },
      );
      if (!isCurrent()) return;

      if (!playCtxRef.current || playCtxRef.current.state === "closed") {
        playCtxRef.current = new AudioContext({ sampleRate: SR });
      }
      if (playCtxRef.current.state === "suspended") {
        await playCtxRef.current.resume();
      }
      if (!isCurrent()) return;

      const buf = playCtxRef.current.createBuffer(1, audio.length, SR);
      buf.getChannelData(0).set(audio);
      audioBufferRef.current = buf;

      const src = playCtxRef.current.createBufferSource();
      src.buffer = buf;
      src.connect(playCtxRef.current.destination);
      sourceRef.current = src;
      setIsPlaying(true);
      setIsLoading(false);
      setStatusType("ok");
      setStatus(
        `${(audio.length / SR).toFixed(1)}s decoded from ${packetBytes.length} bytes`,
      );
      src.onended = () => {
        src.disconnect();
        if (!isCurrent() || sourceRef.current !== src) return;
        sourceRef.current = null;
        setIsPlaying(false);
      };
      src.start();
    } catch (e) {
      if (!isCurrent()) return;
      stopPlayback();
      setStatusType("err");
      setStatus((e as Error).message);
      setIsPlaying(false);
      setIsLoading(false);
    }
  }, [
    isPlaying,
    effectiveQuality,
    effectiveQualityLabel,
    parsed.tokenBytes,
    packetBytes.length,
    tokenCount,
    codecContext,
    stopPlayback,
  ]);

  const handleDownloadModels = useCallback(async () => {
    setStatusType("");
    setStatus(`Downloading ${effectiveQualityLabel} models...`);
    const ok = await codecContext.loadModels(effectiveQuality);
    if (!ok) setStatus("Download cancelled");
  }, [codecContext, effectiveQuality, effectiveQualityLabel]);

  return (
    <div className="text-center">
      {/* Play button */}
      <div className="flex items-center justify-center gap-3 mb-3">
        <button
          className={`inline-flex h-14 w-14 items-center justify-center rounded-full border-2 text-2xl transition-all ${
            isLoading
              ? "animate-pulse border-[var(--yellow)] text-[var(--yellow)]"
              : isPlaying
                ? "border-[var(--green)] bg-[var(--mantle)] text-[var(--green)] hover:scale-105 hover:bg-[var(--surface0)]"
                : "border-[var(--tv-accent)] bg-[var(--mantle)] text-[var(--tv-accent)] hover:scale-105 hover:bg-[var(--surface0)]"
          }`}
          onClick={handlePlay}
          disabled={isLoading || loadingModels}
          aria-label={
            isLoading
              ? "Decoding voice packet"
              : isPlaying
                ? "Stop voice playback"
                : "Play voice packet"
          }
        >
          {isLoading ? (
            <svg
              width="20"
              height="20"
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
          ) : isPlaying ? (
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
              stroke="none"
            >
              <rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
          ) : (
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="currentColor"
              stroke="none"
            >
              <polygon points="6,3 20,12 6,21" />
            </svg>
          )}
        </button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setHexOpen(true)}
        >
          <CodeIcon size={12} />
          Hex
        </Button>
      </div>

      <HexStream
        data={packetBytes}
        active={isPlaying}
        duration={audioBufferRef.current?.duration ?? estDuration}
        label="Token data"
        className="mb-3"
        hasMagicByte={parsed.hasMagicByte}
      />

      {!qualityReady && (
        <Button
          className="mb-3"
          onClick={handleDownloadModels}
          disabled={loadingModels}
        >
          {loadingModels ? "Loading models..." : `Download ${effectiveQualityLabel} models`}
        </Button>
      )}

      {/* Quality override buttons */}
      <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
        <span className="mr-1 text-[0.6rem] text-[var(--overlay)]">
          Decoder:
        </span>
        {QUALITY_BTNS.map((q) => (
          <Button
            key={q.value}
            variant="ghost"
            size="sm"
            className={`h-6 px-2 font-sans text-[0.6rem] ${
              (q.value === "auto" && !qualityOverride) ||
              q.value === qualityOverride
                ? "bg-[var(--surface0)] font-semibold text-[var(--text)]"
                : "text-[var(--overlay)]"
            }`}
            onClick={() => handleQualityChange(q.value)}
          >
            {q.value === "auto" ? autoLabel : q.label}
          </Button>
        ))}
      </div>

      {(loadingModels || isLoading || progress > 0) && (
        <Progress
          value={loadingModels ? codecContext.progress : progress}
          className="mx-auto mb-2 h-1"
        />
      )}

      <p
        className={`min-h-[1.2em] text-[0.72rem] ${
          statusType === "ok"
            ? "text-[var(--green)]"
            : statusType === "err"
              ? "text-[var(--red)]"
              : "text-[var(--overlay)]"
        }`}
      >
        {loadingModels ? codecContext.statusText : status || initialStatus}
      </p>

      {/* Hex Sheet */}
      <HexSheet
        data={packetBytes}
        open={hexOpen}
        onOpenChange={setHexOpen}
        hasMagicByte={parsed.hasMagicByte}
      />
    </div>
  );
}
