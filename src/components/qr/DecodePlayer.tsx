import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import HexSheet from "./HexSheet";
import { codec, type ParsedPacket } from "@/lib/codec-service";
import { Quality } from "@/types/codec";
import { SR } from "@/lib/constants";
import CodeIcon from "@/components/ui/code-icon";

const QUALITY_BTNS: { label: string; value: string }[] = [
  { label: "Auto", value: "auto" },
  { label: "12.5hz", value: Quality.Hz12_5 },
  { label: "25hz", value: Quality.Hz25 },
  { label: "50hz", value: Quality.Hz50 },
];

interface DecodePlayerProps {
  parsed: ParsedPacket;
}

export default function DecodePlayer({ parsed }: DecodePlayerProps) {
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

  const tokenCount = parsed.tokenBytes.length / 2;
  const effectiveQuality = qualityOverride || parsed.quality;
  const estDuration = codec.estimateDuration(tokenCount, effectiveQuality);

  const initialStatus = `${parsed.tokenBytes.length}B, ${tokenCount} tok, ~${estDuration.toFixed(1)}s \u00b7 ${parsed.quality}${parsed.hasMagicByte ? "" : " (guessed)"}`;

  const handleQualityChange = useCallback(
    (q: string) => {
      const newQ = q === "auto" ? null : (q as Quality);
      setQualityOverride(newQ);
      audioBufferRef.current = null;
      setStatus(
        `Decoder set to ${newQ || `auto (${parsed.quality})`}`,
      );
      setStatusType("");
    },
    [parsed.quality],
  );

  const handlePlay = useCallback(async () => {
    if (isPlaying && sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {
        // ignore
      }
      sourceRef.current = null;
      setIsPlaying(false);
      return;
    }

    if (audioBufferRef.current) {
      if (!playCtxRef.current || playCtxRef.current.state === "closed") {
        playCtxRef.current = new AudioContext({ sampleRate: SR });
      }
      if (playCtxRef.current.state === "suspended") {
        await playCtxRef.current.resume();
      }
      const src = playCtxRef.current.createBufferSource();
      src.buffer = audioBufferRef.current;
      src.connect(playCtxRef.current.destination);
      sourceRef.current = src;
      setIsPlaying(true);
      src.onended = () => {
        setIsPlaying(false);
        sourceRef.current = null;
      };
      src.start();
      return;
    }

    setIsLoading(true);
    try {
      const q = effectiveQuality;
      const audio = await codec.decodeTokens(
        parsed.tokenBytes,
        tokenCount,
        q,
        (info) => {
          setProgress(info.fraction * 100);
          setStatus(info.status);
          setStatusType("");
        },
      );

      playCtxRef.current = new AudioContext({ sampleRate: SR });
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
        `${(audio.length / SR).toFixed(1)}s decoded from ${parsed.tokenBytes.length} bytes`,
      );
      src.onended = () => {
        setIsPlaying(false);
        sourceRef.current = null;
      };
      src.start();
    } catch (e) {
      setStatusType("err");
      setStatus((e as Error).message);
      setIsLoading(false);
    }
  }, [isPlaying, effectiveQuality, parsed]);

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
          disabled={isLoading}
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

      {/* Quality override buttons */}
      <div className="mb-2 flex items-center justify-center gap-1">
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
            {q.label}
          </Button>
        ))}
      </div>

      {(isLoading || progress > 0) && (
        <Progress value={progress} className="mx-auto mb-2 h-1" />
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
        {status || initialStatus}
      </p>

      {/* Hex Sheet */}
      <HexSheet
        data={parsed.tokenBytes}
        open={hexOpen}
        onOpenChange={setHexOpen}
      />
    </div>
  );
}
