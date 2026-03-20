import { WaveformCanvas } from "./WaveformCanvas";

interface RecordingInfoProps {
  active: boolean;
  duration: number;
  analyserNode: AnalyserNode | null;
}

export function RecordingInfo({ active, duration, analyserNode }: RecordingInfoProps) {
  if (!active) return null;

  return (
    <div className="flex items-center gap-2.5 mt-2.5 h-8">
      <WaveformCanvas analyserNode={analyserNode} active={active} />
      <span className="font-mono text-[0.85rem] font-semibold text-[var(--red)] min-w-[3em] tabular-nums">
        {duration.toFixed(1)}s
      </span>
    </div>
  );
}
