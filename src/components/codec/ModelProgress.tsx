interface ModelProgressProps {
  value: number; // 0..100
}

export function ModelProgress({ value }: ModelProgressProps) {
  return (
    <div className="w-full h-0.5 bg-[var(--surface0)] rounded-sm overflow-hidden mt-1.5">
      <div
        className="h-full bg-[var(--accent)] transition-[width] duration-250"
        style={{ width: `${Math.min(100, value)}%` }}
      />
    </div>
  );
}
