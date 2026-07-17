import type { RecordFlow } from "@/hooks/useRecordFlow";

/** Visible toggle for cutting the pre-speech dead silence. */
export function TrimToggle({ flow }: { flow: RecordFlow }) {
  const on = flow.trimEnabled;
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => flow.setTrimEnabled(!on)}
      className="flex cursor-pointer items-center gap-2 rounded-full border border-[var(--surface0)] px-3 py-1.5 font-sans text-[0.62rem] text-[var(--overlay)] transition-colors hover:border-[var(--surface1)] hover:text-[var(--subtext)]"
    >
      <span
        className={`relative h-3 w-6 flex-shrink-0 rounded-full transition-colors ${
          on ? "bg-[var(--green)]" : "bg-[var(--surface1)]"
        }`}
      >
        <span
          className={`absolute top-0.5 size-2 rounded-full bg-[var(--base)] transition-all ${
            on ? "left-3.5" : "left-0.5"
          }`}
        />
      </span>
      Trim lead-in silence
    </button>
  );
}
