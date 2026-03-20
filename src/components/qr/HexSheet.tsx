import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";

interface HexSheetProps {
  data: Uint8Array | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function HexSheet({ data, open, onOpenChange }: HexSheetProps) {
  if (!data) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-[var(--base)] border-[var(--surface0)] w-[min(85vw,400px)]"
      >
        <SheetHeader>
          <SheetTitle className="text-[0.7rem] font-semibold uppercase tracking-wider text-[var(--overlay)]">
            Token Data
          </SheetTitle>
          <SheetDescription className="text-xs text-[var(--overlay)]">
            {data.length} bytes · raw hex dump
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="flex-1 px-4 pb-4">
          <div className="break-all font-mono text-[0.55rem] leading-relaxed text-[var(--overlay)]">
            {Array.from(data).map((byte, i) => (
              <span key={i}>
                <span
                  className={`inline-block w-[1.5em] text-center ${
                    i === 0
                      ? "text-[var(--tv-accent)] font-bold"
                      : "text-[var(--subtext)]"
                  }`}
                >
                  {byte.toString(16).padStart(2, "0")}
                </span>
                {i < data.length - 1 ? " " : ""}
              </span>
            ))}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
