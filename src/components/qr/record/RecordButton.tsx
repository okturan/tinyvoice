import { Progress } from "@/components/ui/progress";
import type { RecordFlow } from "@/hooks/useRecordFlow";

const MicIcon = ({ size = 28 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
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
);

const SpinnerIcon = () => (
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
);

interface RecordButtonProps {
  flow: RecordFlow;
  size?: "lg" | "sm";
  showHint?: boolean;
}

/** The circular HOLD button with waveform, timer, hint, and encode progress. */
export function RecordButton({ flow, size = "lg", showHint = true }: RecordButtonProps) {
  const { readyToRecord, recordState, recTime, encodeProgress } = flow;
  const dim = size === "lg" ? "h-[100px] w-[100px]" : "h-[76px] w-[76px]";

  return (
    <div className="flex flex-col items-center">
      <button
        className={`mb-3 flex ${dim} cursor-pointer select-none flex-col items-center justify-center gap-1 rounded-full border-2 font-sans text-xs font-semibold transition-all ${
          !readyToRecord
            ? "cursor-not-allowed border-[var(--surface1)] bg-[var(--mantle)] text-[var(--overlay)] opacity-30"
            : recordState === "recording"
              ? "border-[var(--red)] bg-[color-mix(in_srgb,var(--red)_8%,var(--base))] text-[var(--red)]"
              : recordState === "encoding"
                ? "animate-pulse border-[var(--yellow)] text-[var(--yellow)]"
                : "border-[var(--surface1)] bg-[var(--mantle)] text-[var(--overlay)] hover:border-[var(--surface2)] hover:bg-[var(--surface0)] hover:text-[var(--subtext)]"
        }`}
        onPointerDown={flow.recDown}
        onPointerUp={flow.recUp}
        onPointerLeave={flow.recUp}
        disabled={!readyToRecord}
      >
        {recordState === "encoding" ? <SpinnerIcon /> : <MicIcon size={size === "lg" ? 28 : 20} />}
        <span className={size === "sm" ? "text-[0.6rem]" : ""}>
          {recordState === "encoding" ? "ENCODING" : "HOLD"}
        </span>
      </button>

      {/* Waveform + timer */}
      <div
        className={`flex h-8 items-center justify-center gap-2.5 ${
          recordState === "recording" ? "" : "hidden"
        }`}
      >
        <canvas
          ref={flow.canvasRef}
          className={`h-8 rounded-md ${size === "lg" ? "w-40" : "w-24"}`}
          width={200}
          height={32}
        />
        <span className="min-w-[3em] font-mono text-sm font-semibold tabular-nums text-[var(--red)]">
          {recTime}
        </span>
      </div>

      {showHint && recordState !== "recording" && (
        <p className="text-[0.65rem] text-[var(--overlay)] opacity-60">
          hold to record · release to encode
        </p>
      )}

      {/* Encode progress (only during encode) */}
      {recordState === "encoding" && (
        <Progress value={encodeProgress} className="mt-2 h-1 w-40" />
      )}
    </div>
  );
}
