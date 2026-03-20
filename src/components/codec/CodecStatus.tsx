import type { CodecState } from "@/contexts/CodecContext";

interface CodecStatusProps {
  state: CodecState;
  text: string;
}

const DOT_CLASSES: Record<CodecState, string> = {
  idle: "bg-[var(--surface2)]",
  loading: "bg-[var(--yellow)] animate-pulse",
  ready: "bg-[var(--green)]",
  error: "bg-[var(--red)]",
};

export function CodecStatus({ state, text }: CodecStatusProps) {
  return (
    <div className="flex items-center gap-1.5 text-[0.75rem] text-[var(--subtext)]">
      <span
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${DOT_CLASSES[state]}`}
      />
      <span>{text}</span>
    </div>
  );
}
