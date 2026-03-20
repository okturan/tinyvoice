import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface HexSidebarProps {
  data: Uint8Array | null;
  open: boolean;
  onClose: () => void;
  animating?: boolean;
  animationProgress?: number;
}

export default function HexSidebar({
  data,
  open,
  onClose,
  animating = false,
  animationProgress = 0,
}: HexSidebarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (animating && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [animating, animationProgress]);

  if (!data) return null;

  const litCount = animating ? Math.floor(data.length * animationProgress) : 0;
  const isDone = !animating && animationProgress >= 1;

  return (
    <div
      className={`fixed inset-y-0 right-0 z-50 flex w-[min(45vw,360px)] flex-col border-l border-[var(--surface0)] bg-[var(--base)] shadow-[-4px_0_20px_rgba(0,0,0,0.3)] transition-transform duration-250 ease-out ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
    >
      <div className="flex items-center justify-between border-b border-[var(--surface0)] px-4 py-3 text-[0.7rem] font-semibold uppercase tracking-wider text-[var(--overlay)]">
        <span>Token Data</span>
        <Button
          variant="secondary"
          size="icon"
          className="h-6 w-6 text-base"
          onClick={onClose}
        >
          &times;
        </Button>
      </div>
      <ScrollArea className="flex-1 p-4">
        <div
          ref={scrollRef}
          className="break-all font-mono text-[0.55rem] leading-relaxed text-[var(--surface2)]"
        >
          {Array.from(data).map((byte, i) => {
            let colorClass = "";
            if (animating && i < litCount) {
              colorClass =
                "text-[var(--green)] [text-shadow:0_0_6px_color-mix(in_srgb,var(--green)_40%,transparent)]";
            } else if (isDone) {
              colorClass = "text-[var(--overlay)]";
            }
            return (
              <span key={i}>
                <span
                  className={`inline-block w-[1.5em] text-center transition-colors duration-100 ${colorClass}`}
                >
                  {byte.toString(16).padStart(2, "0")}
                </span>
                {i < data.length - 1 ? " " : ""}
              </span>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
