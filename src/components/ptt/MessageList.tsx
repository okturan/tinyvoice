import { useEffect, useRef, useState } from "react";
import { Play, Square, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { HexDump } from "@/components/ptt/HexDump";
import { qualityLabel } from "@/lib/format";
import type { Quality } from "@/types/codec";

export interface VoiceMessage {
  id: number;
  dir: "sent" | "recv";
  sender: string;
  packet: Uint8Array;
  quality: Quality | null;
  duration: number | null;
  time: number;
}

interface MessageListProps {
  messages: VoiceMessage[];
  /** Message currently playing, if any */
  playingId: number | null;
  /** Message currently being decoded for replay */
  loadingId: number | null;
  onPlay: (message: VoiceMessage) => void;
}

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});

export function MessageList({ messages, playingId, loadingId, onPlay }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const [openHexIds, setOpenHexIds] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const toggleHex = (id: number) => {
    setOpenHexIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (messages.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--surface2)]">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-40">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" x2="12" y1="19" y2="22" />
        </svg>
        <span className="text-[0.7rem]">Voice messages appear here</span>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-1.5 p-3">
        {messages.map((message) => {
          const mine = message.dir === "sent";
          const playing = playingId === message.id;
          const loading = loadingId === message.id;
          return (
            <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-lg border px-2.5 py-1.5 ${
                  mine
                    ? "border-[var(--surface1)] bg-[var(--base)]"
                    : "border-[var(--surface0)] bg-[var(--base)]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onPlay(message)}
                    disabled={loading}
                    aria-label={playing ? "Stop" : "Play"}
                    className={`flex size-7 flex-shrink-0 cursor-pointer items-center justify-center rounded-full border transition-colors ${
                      playing
                        ? "border-[var(--green)] text-[var(--green)]"
                        : "border-[var(--surface1)] text-[var(--overlay)] hover:border-[var(--tv-accent)]/50 hover:text-[var(--tv-accent)]"
                    }`}
                  >
                    {loading ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : playing ? (
                      <Square className="size-2.5 fill-current" />
                    ) : (
                      <Play className="size-3 fill-current" />
                    )}
                  </button>
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-1.5">
                      <span className={`truncate font-mono text-[0.68rem] font-semibold ${mine ? "text-[var(--tv-accent)]" : "text-[var(--teal)]"}`}>
                        {mine ? "You" : message.sender}
                      </span>
                      <span className="flex-shrink-0 text-[0.55rem] text-[var(--overlay)]">
                        {timeFormat.format(message.time)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 font-mono text-[0.6rem] text-[var(--overlay)]">
                      <span>{message.duration !== null ? `${message.duration.toFixed(1)}s` : "…"}</span>
                      <span>·</span>
                      <span>{message.packet.length} B</span>
                      {message.quality && (
                        <>
                          <span>·</span>
                          <span>{qualityLabel(message.quality)}</span>
                        </>
                      )}
                      <button
                        onClick={() => toggleHex(message.id)}
                        className="cursor-pointer text-[var(--overlay)] transition-colors hover:text-[var(--text)]"
                      >
                        hex
                      </button>
                    </div>
                  </div>
                </div>
                <HexDump
                  data={message.packet}
                  type={message.dir === "sent" ? "sent" : "recv"}
                  open={openHexIds.has(message.id)}
                  showTrigger={false}
                />
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </ScrollArea>
  );
}
