import { useEffect, useRef } from "react";
import { HexDump } from "./HexDump";

export interface LogEntry {
  id: number;
  message: string;
  type: "ok" | "info" | "warn" | "dim" | "recv" | "name";
  hexData?: Uint8Array;
  hexType?: "sent" | "recv";
}

interface ActivityLogProps {
  entries: LogEntry[];
}

const TYPE_CLASSES: Record<LogEntry["type"], string> = {
  ok: "text-[var(--green)]",
  info: "text-[var(--blue)]",
  warn: "text-[var(--yellow)]",
  dim: "text-[var(--surface2)]",
  recv: "text-[var(--teal)]",
  name: "text-[var(--accent)] font-semibold",
};

export function ActivityLog({ entries }: ActivityLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  return (
    <div className="border-t border-[var(--surface0)] px-3 py-2 bg-[var(--mantle)] flex-1 min-h-0 flex flex-col">
      <div
        ref={scrollRef}
        className="font-mono text-[0.68rem] leading-[1.7] flex-1 min-h-0 overflow-y-auto text-[var(--overlay)] scrollbar-thin scrollbar-w-[3px] scrollbar-thumb-[var(--surface1)]"
      >
        {entries.map((entry) => (
          <div key={entry.id}>
            <div className={TYPE_CLASSES[entry.type]}>{entry.message}</div>
            {entry.hexData && entry.hexType && (
              <HexDump data={entry.hexData} type={entry.hexType} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
