import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface HexStreamProps {
  data: Uint8Array;
  active: boolean;
  duration: number;
  className?: string;
  label?: string;
  hasMagicByte?: boolean;
}

const HEAD_CLASS =
  "font-bold text-[var(--green)] [text-shadow:0_0_8px_color-mix(in_srgb,var(--green)_60%,transparent)]";
const UNPLAYED_CLASS =
  "text-[color-mix(in_srgb,var(--subtext)_52%,var(--mantle))]";

/** Comet tail: bytes just behind the head fade from green back to resting subtext. */
function trailClass(distance: number): string | undefined {
  if (distance === 0) return HEAD_CLASS;
  if (distance === 1) return "text-[var(--green)]";
  if (distance === 2) return "text-[color-mix(in_srgb,var(--green)_70%,var(--subtext))]";
  if (distance <= 4) return "text-[color-mix(in_srgb,var(--green)_45%,var(--subtext))]";
  if (distance <= 7) return "text-[color-mix(in_srgb,var(--green)_25%,var(--subtext))]";
  return undefined;
}

export function HexStream({
  data,
  active,
  duration,
  className,
  label = "Token data",
  hasMagicByte = true,
}: HexStreamProps) {
  const [activeByte, setActiveByte] = useState(-1);
  const dumpRef = useRef<HTMLDivElement | null>(null);
  const activeCellRef = useRef<HTMLSpanElement | null>(null);

  const bytes = useMemo(
    () => Array.from(data, (byte, index) => ({
      index,
      hex: byte.toString(16).padStart(2, "0"),
    })),
    [data],
  );
  const payloadStart = hasMagicByte && data.length > 1 ? 1 : 0;
  const payloadLength = Math.max(0, data.length - payloadStart);
  const displayedByte =
    activeByte >= payloadStart && activeByte < data.length ? activeByte : -1;

  useEffect(() => {
    let animationFrame = 0;

    if (!active || payloadLength === 0) {
      setActiveByte(-1);
      return;
    }

    setActiveByte(payloadStart);
    if (!Number.isFinite(duration) || duration <= 0) return;

    const durationMs = duration * 1_000;
    let startedAt: number | null = null;

    const advance = (now: number) => {
      startedAt ??= now;
      const progress = Math.min((now - startedAt) / durationMs, 1);
      const nextByte = payloadStart + Math.min(
        payloadLength - 1,
        Math.floor(progress * payloadLength),
      );
      setActiveByte((previous) =>
        previous === nextByte ? previous : nextByte,
      );

      if (progress < 1) animationFrame = requestAnimationFrame(advance);
    };

    animationFrame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(animationFrame);
  }, [active, data, duration, payloadLength, payloadStart]);

  useEffect(() => {
    if (!active) return;
    const dump = dumpRef.current;
    const cell = activeCellRef.current;
    if (!dump || !cell) return;

    const cellTop = cell.offsetTop;
    const cellBottom = cellTop + cell.offsetHeight;
    const visibleTop = dump.scrollTop;
    const visibleBottom = visibleTop + dump.clientHeight;
    if (cellTop >= visibleTop && cellBottom <= visibleBottom) return;

    dump.scrollTop = Math.max(
      0,
      cellTop - (dump.clientHeight - cell.offsetHeight) / 2,
    );
  }, [active, displayedByte]);

  return (
    <section
      className={cn("text-left", className)}
      aria-label={label}
    >
      <div className="mb-3">
        <div className="text-[0.7rem] font-semibold uppercase tracking-wider text-[var(--overlay)]">
          {label}
        </div>
        <div className="mt-1 text-xs text-[var(--overlay)]">
          {data.length} bytes · raw hex dump
        </div>
      </div>

      <div
        ref={dumpRef}
        className="relative max-h-36 overflow-y-auto break-all font-mono text-[0.55rem] leading-relaxed text-[var(--subtext)]"
        aria-live="off"
      >
        {bytes.map((byte, index) => {
          const hasHead = active && displayedByte >= 0;
          const isCurrent = hasHead && byte.index === displayedByte;
          const isHeader = hasMagicByte && byte.index === 0;
          const playbackClass = hasHead && !isHeader
            ? byte.index > displayedByte
              ? UNPLAYED_CLASS
              : trailClass(displayedByte - byte.index)
            : undefined;

          return (
            <span
              key={byte.index}
            >
              <span
                ref={isCurrent ? activeCellRef : undefined}
                aria-current={isCurrent ? "true" : undefined}
                className={cn(
                  "inline-block w-[1.5em] text-center tabular-nums",
                  isHeader && "font-bold text-[var(--tv-accent)]",
                  playbackClass,
                )}
              >
                {byte.hex}
              </span>
              {index < bytes.length - 1 ? " " : ""}
            </span>
          );
        })}
      </div>
    </section>
  );
}

export default HexStream;
