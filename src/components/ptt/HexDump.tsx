import { useState } from "react";
import { fmt } from "@/lib/format";

interface HexDumpProps {
  data: Uint8Array;
  type: "sent" | "recv";
}

export function HexDump({ data, type }: HexDumpProps) {
  const [open, setOpen] = useState(false);

  const colorClass = type === "sent" ? "text-[var(--green)]" : "text-[var(--teal)]";
  const hexColorClass =
    type === "sent"
      ? "text-[color-mix(in_srgb,var(--green)_40%,var(--surface2))]"
      : "text-[color-mix(in_srgb,var(--teal)_40%,var(--surface2))]";

  return (
    <div className="my-px">
      <div
        className="inline-flex items-center gap-1 cursor-pointer select-none group"
        onClick={() => setOpen(!open)}
      >
        <span
          className={`text-[0.55rem] text-[var(--overlay)] transition-transform duration-150 inline-block group-hover:text-[var(--accent)] ${open ? "rotate-90" : ""}`}
        >
          {"\u25b8"}
        </span>
        <span className={colorClass}>
          {fmt(data.length)} {"\u2014"} raw token data
        </span>
      </div>
      {open && (
        <div className="bg-[var(--crust)] border border-[var(--surface0)] rounded-md p-2 px-2.5 mt-0.5 max-h-28 overflow-y-auto leading-[1.9] scrollbar-thin scrollbar-thumb-[var(--surface1)]">
          {Array.from(data).map((byte, i) => (
            <span
              key={i}
              className={`inline-block w-[1.7em] text-center text-[0.6rem] ${hexColorClass}`}
            >
              {byte.toString(16).padStart(2, "0")}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
