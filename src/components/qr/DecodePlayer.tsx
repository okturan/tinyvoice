import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { decode, estimateDuration, type ParsedTokens } from "@/lib/codec";
import { SR, type Quality } from "@/lib/constants";

const QUALITY_BTNS: { label: string; value: string }[] = [
  { label: "Auto", value: "auto" },
  { label: "12.5hz", value: "12_5hz" },
  { label: "25hz", value: "25hz" },
  { label: "50hz", value: "50hz" },
];

interface DecodePlayerProps {
  parsed: ParsedTokens;
}

export default function DecodePlayer({ parsed }: DecodePlayerProps) {
  const [qualityOverride, setQualityOverride] = useState<Quality | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState<"" | "ok" | "err">("");

  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);

  const effectiveQuality = qualityOverride || parsed.quality;
  const estDuration = estimateDuration(parsed.tokenCount, effectiveQuality);

  // Build initial status
  const hasMagic =
    parsed.tokens.length !== parsed.tokenCount * 2; // simplified check
  const initialStatus = `${parsed.tokens.length}B, ${parsed.tokenCount} tok, ~${estDuration.toFixed(1)}s \u00b7 ${parsed.quality}${hasMagic ? "" : " (guessed)"} \u2014 tap play`;

  const handleQualityChange = useCallback(
    (q: string) => {
      const newQ = q === "auto" ? null : (q as Quality);
      setQualityOverride(newQ);
      audioBufferRef.current = null; // force re-decode
      setStatus(
        `Decoder set to ${newQ || `auto (${parsed.quality})`} \u2014 tap play`,
      );
      setStatusType("");
    },
    [parsed.quality],
  );

  const handlePlay = useCallback(async () => {
    // Stop if playing
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

    // Replay from cache
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

    // Decode
    setIsLoading(true);
    try {
      const q = effectiveQuality;
      const audio = await decode(parsed.tokens, parsed.tokenCount, q, {
        onProgress: (p) => setProgress(p * 100),
        onStatus: (msg) => {
          setStatus(msg);
          setStatusType("");
        },
      });

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
        `${(audio.length / SR).toFixed(1)}s decoded from ${parsed.tokens.length} bytes \u2014 click to stop`,
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
    <div className="mt-4 border-t border-[var(--surface0)] pt-4 text-center">
      {/* Hex display */}
      <div className="mx-auto mb-3 max-h-20 overflow-y-auto break-all font-mono text-[0.55rem] leading-relaxed text-[var(--surface2)]">
        {Array.from(parsed.tokens).map((byte, i) => (
          <span key={i}>
            <span className="inline-block w-[1.5em] text-center">
              {byte.toString(16).padStart(2, "0")}
            </span>
            {i < parsed.tokens.length - 1 ? " " : ""}
          </span>
        ))}
      </div>

      {/* Play button */}
      <button
        className={`mx-auto mb-2 inline-flex h-16 w-16 items-center justify-center rounded-full border-2 text-2xl transition-all ${
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
            width="22"
            height="22"
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
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="currentColor"
            stroke="none"
          >
            <rect x="4" y="4" width="16" height="16" rx="2" />
          </svg>
        ) : (
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="currentColor"
            stroke="none"
          >
            <polygon points="6,3 20,12 6,21" />
          </svg>
        )}
      </button>

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

      <Progress value={progress} className="mx-auto mb-2 h-0.5" />

      <p
        className={`min-h-[1.4em] text-[0.72rem] ${
          statusType === "ok"
            ? "text-[var(--green)]"
            : statusType === "err"
              ? "text-[var(--red)]"
              : "text-[var(--overlay)]"
        }`}
      >
        {status || initialStatus}
      </p>
    </div>
  );
}
