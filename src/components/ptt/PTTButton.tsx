import { Mic, Loader2, Square } from "lucide-react";

export type PTTState = "idle" | "recording" | "encoding" | "sending" | "disabled";

interface PTTButtonProps {
  state: PTTState;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}

const STATE_CLASSES: Record<PTTState, string> = {
  idle: "border-[var(--surface1)] bg-[var(--mantle)] text-[var(--overlay)] hover:border-[var(--surface2)] hover:bg-[var(--surface0)] hover:text-[var(--subtext)] cursor-pointer",
  recording:
    "border-[var(--red)] bg-[color-mix(in_srgb,var(--red)_8%,var(--base))] text-[var(--red)] cursor-pointer",
  encoding:
    "border-[var(--yellow)] bg-[color-mix(in_srgb,var(--yellow)_6%,var(--base))] text-[var(--yellow)]",
  sending:
    "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_6%,var(--base))] text-[var(--accent)]",
  disabled: "opacity-15 cursor-not-allowed border-[var(--surface1)] bg-[var(--mantle)] text-[var(--overlay)]",
};

const LABELS: Record<PTTState, string> = {
  idle: "HOLD",
  recording: "RELEASE",
  encoding: "ENCODING",
  sending: "SENDING",
  disabled: "HOLD",
};

function PTTIcon({ state }: { state: PTTState }) {
  switch (state) {
    case "recording":
      return <Square className="w-7 h-7" />;
    case "encoding":
      return <Loader2 className="w-7 h-7 animate-spin" />;
    default:
      return <Mic className="w-7 h-7" />;
  }
}

export function PTTButton({ state, onPointerDown, onPointerUp }: PTTButtonProps) {
  return (
    <button
      className={`w-[130px] h-[130px] rounded-full border-2 font-sans text-[0.8rem] font-semibold transition-all duration-150 flex flex-col items-center justify-center gap-1 select-none touch-none ${STATE_CLASSES[state]}`}
      onPointerDown={(e) => {
        e.preventDefault();
        if (state !== "disabled") onPointerDown(e);
      }}
      onPointerUp={(e) => {
        e.preventDefault();
        onPointerUp(e);
      }}
      onPointerLeave={(e) => {
        e.preventDefault();
        onPointerUp(e);
      }}
    >
      <PTTIcon state={state} />
      <span>{LABELS[state]}</span>
    </button>
  );
}
