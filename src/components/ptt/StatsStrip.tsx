import { useStats } from "@/contexts/StatsContext";

function Stat({
  value,
  label,
  colorClass,
}: {
  value: string;
  label: string;
  colorClass?: string;
}) {
  return (
    <div className="flex-1 text-center py-1.5 bg-[var(--mantle)] rounded-[7px] border border-[var(--surface0)]">
      <div
        className={`font-mono text-[0.88rem] font-semibold ${colorClass || "text-[var(--text)]"}`}
      >
        {value}
      </div>
      <div className="text-[0.48rem] text-[var(--overlay)] uppercase tracking-wider mt-0.5">
        {label}
      </div>
    </div>
  );
}

export function StatsStrip() {
  const { bytesSent, encodeTime, bytesRecv, decodeTime } = useStats();

  return (
    <div className="flex gap-1.5">
      <Stat
        value={bytesSent}
        label="bytes sent"
        colorClass={bytesSent !== "\u2014" ? "text-[var(--green)]" : undefined}
      />
      <Stat value={encodeTime} label="encode" />
      <Stat
        value={bytesRecv}
        label="bytes recv"
        colorClass={bytesRecv !== "\u2014" ? "text-[var(--blue)]" : undefined}
      />
      <Stat value={decodeTime} label="decode" />
    </div>
  );
}
