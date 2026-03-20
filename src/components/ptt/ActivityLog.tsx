import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  name: "text-[var(--tv-accent)] font-semibold",
};

export function ActivityLog({ entries }: ActivityLogProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  return (
    <div className="border border-[var(--surface0)] rounded-lg bg-[var(--mantle)] flex-1 min-h-0 flex flex-col overflow-hidden">
      <ScrollArea className="flex-1 min-h-0">
        <div className="font-mono text-[0.68rem] leading-[1.7] text-[var(--overlay)] p-3">
          {entries.length === 0 && (
            <div className="text-[var(--surface2)] text-center py-4">
              Join a room and load models to start
            </div>
          )}
          {entries.map((entry) => (
            <div key={entry.id}>
              {entry.message && (
                <div className={TYPE_CLASSES[entry.type]}>{entry.message}</div>
              )}
              {entry.hexData && entry.hexType && (
                <HexDump data={entry.hexData} type={entry.hexType} />
              )}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      </ScrollArea>
    </div>
  );
}
