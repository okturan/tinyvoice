import { useState, useCallback, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Mic, Square, Loader2 } from "lucide-react";
import GearIcon from "@/components/ui/gear-icon";
import { useCodecContext } from "@/contexts/CodecContext";
import { useStats } from "@/contexts/StatsContext";
import { useRoom } from "@/contexts/RoomContext";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ShareModal } from "@/components/ptt/ShareModal";
import { HexDump } from "@/components/ptt/HexDump";
import { WaveformCanvas } from "@/components/ptt/WaveformCanvas";
import { ModelManagement } from "@/components/codec/ModelManagement";
import { SR, SUGGESTED_ROOMS } from "@/lib/constants";
import { randomRoomName } from "@/lib/utils/names";
import { fmt } from "@/lib/format";

type PTTState = "idle" | "recording" | "encoding" | "sending" | "disabled";

interface LogEntry {
  id: number;
  message: string;
  type: "ok" | "info" | "warn" | "dim" | "recv" | "name";
  hexData?: Uint8Array;
  hexType?: "sent" | "recv";
}

const LOG_COLORS: Record<LogEntry["type"], string> = {
  ok: "text-[var(--green)]",
  info: "text-[var(--blue)]",
  warn: "text-[var(--yellow)]",
  dim: "text-[var(--overlay)]",
  recv: "text-[var(--teal)]",
  name: "text-[var(--tv-accent)] font-medium",
};

let logId = 0;

export function PTTPage() {
  const codec = useCodecContext();
  const stats = useStats();
  const room = useRoom();
  const recorder = useAudioRecorder();
  const player = useAudioPlayer();

  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [pttState, setPttState] = useState<PTTState>("disabled");
  const [roomInput, setRoomInput] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [shareData, setShareData] = useState({ url: "", bytes: 0, tokens: 0, duration: "" });
  const [username, setUsername] = useState(() => localStorage.getItem("fc-username") || "");

  const logEndRef = useRef<HTMLDivElement>(null);
  const isPttReady = codec.modelsLoaded && room.isConnected;

  const addLog = useCallback((message: string, type: LogEntry["type"] = "dim", hexData?: Uint8Array, hexType?: "sent" | "recv") => {
    setLogEntries(prev => {
      const next = [...prev, { id: ++logId, message, type, hexData, hexType }];
      return next.length > 200 ? next.slice(-200) : next;
    });
  }, []);

  const handleUsernameChange = (v: string) => { setUsername(v); localStorage.setItem("fc-username", v); };

  // ── Room events ──
  const prevConnected = useRef(room.isConnected);
  useEffect(() => {
    if (room.isConnected && !prevConnected.current && room.currentRoom) {
      addLog(`Joined "${room.currentRoom}"`, "ok");
      if (codec.modelsLoaded) setPttState("idle");
    } else if (!room.isConnected && prevConnected.current) {
      addLog("Disconnected", "dim");
      setPttState("disabled");
    }
    prevConnected.current = room.isConnected;
  }, [room.isConnected, room.currentRoom, codec.modelsLoaded, addLog]);

  const prevUserCount = useRef(room.userCount);
  useEffect(() => {
    if (room.isConnected && room.userCount !== prevUserCount.current) {
      stats.setUserCount(room.userCount);
      addLog(`${room.userCount} user${room.userCount !== 1 ? "s" : ""} in room`, "dim");
    }
    prevUserCount.current = room.userCount;
  }, [room.isConnected, room.userCount, stats, addLog]);

  // ── Decode incoming ──
  const handleDecode = useCallback(async (data: ArrayBuffer) => {
    const packet = new Uint8Array(data);
    stats.addRecv(packet.length);
    stats.setLastRecv(packet.length);
    addLog(`Received ${fmt(packet.length)}`, "recv");
    try {
      const t0 = performance.now();
      const audio = await codec.decode(packet);
      const dt = (performance.now() - t0) / 1000;
      addLog(`Decoded ${dt.toFixed(2)}s \u2192 ${(audio.length / SR).toFixed(1)}s audio`, "ok");
      stats.setDecodeTime(dt);
      await player.play(audio);
    } catch (e) {
      addLog("Decode: " + (e instanceof Error ? e.message : String(e)), "warn");
    }
  }, [codec, stats, player, addLog]);

  useEffect(() => room.onPacketReceived(handleDecode), [room, handleDecode]);

  // ── PTT handlers ──
  const handleDown = useCallback(async () => {
    if (!isPttReady || recorder.isRecording) return;
    setPttState("recording");
    addLog("Recording...", "warn");
    try { await recorder.startRecording(); }
    catch (e) { addLog("Mic: " + (e instanceof Error ? e.message : String(e)), "warn"); setPttState("idle"); }
  }, [isPttReady, recorder, addLog]);

  const handleUp = useCallback(async () => {
    if (!recorder.isRecording) return;
    const audio = recorder.stopRecording();
    if (!audio) { addLog("Too short", "dim"); setPttState("idle"); return; }
    setPttState("encoding");
    await new Promise(r => setTimeout(r, 50));
    const dur = (audio.length / SR).toFixed(1);
    addLog(`${dur}s recorded`, "info");
    try {
      const t0 = performance.now();
      const packet = await codec.encode(audio);
      const dt = (performance.now() - t0) / 1000;
      stats.setEncodeTime(dt);
      stats.setLastSent(packet.length);
      stats.addSent(packet.length);
      addLog(`Encoded ${dt.toFixed(2)}s \u2192 ${(packet.length - 1) / 2} tokens`, "ok");
      const b64 = btoa(String.fromCharCode(...packet));
      setShareData({ url: `${location.origin}/qr?v=${encodeURIComponent(b64)}`, bytes: packet.length, tokens: (packet.length - 1) / 2, duration: dur });
      setShareOpen(true);
      room.sendPacket(packet.buffer);
      addLog(`Sent ${fmt(packet.length)}`, "ok");
    } catch (e) {
      addLog("Encode: " + (e instanceof Error ? e.message : String(e)), "warn");
    }
    setPttState(isPttReady ? "idle" : "disabled");
  }, [recorder, codec, stats, room, addLog, isPttReady]);

  const effectiveState: PTTState =
    pttState === "recording" || pttState === "encoding" || pttState === "sending"
      ? pttState : isPttReady ? "idle" : "disabled";

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logEntries]);
  const handleJoin = (name?: string) => { const r = name || roomInput.trim(); if (r) room.joinRoom(r); };

  return (
    <>
      <div className="min-h-screen bg-[var(--crust)] text-[var(--text)] flex items-center justify-center p-3">
        <div className="w-full max-w-[960px] max-h-[calc(100vh-1.5rem)] h-[700px] mx-auto rounded-xl border border-[var(--surface0)] bg-[var(--base)] overflow-hidden flex flex-col">

          {/* ── Header ── */}
          <header className="flex items-center h-11 px-4 bg-[var(--mantle)] border-b border-[var(--surface0)] flex-shrink-0">
            <span className="text-sm font-bold">TinyVoice</span>
            <nav className="flex gap-0.5 ml-3">
              <span className="px-2.5 py-0.5 rounded text-[0.65rem] font-semibold bg-[var(--surface0)] text-[var(--text)]">PTT</span>
              <Link to="/qr" className="px-2.5 py-0.5 rounded text-[0.65rem] font-semibold text-[var(--overlay)] hover:text-[var(--subtext)] hover:bg-[var(--surface0)]/50 transition-colors no-underline">QR</Link>
            </nav>
            <div className="flex-1" />
            <div className="flex items-center gap-3 text-[0.7rem] font-mono text-[var(--overlay)]">
              <span>sent <span className="text-[var(--text)]">{stats.totalSent > 0 ? fmt(stats.totalSent) : "0 B"}</span></span>
              <span>recv <span className="text-[var(--text)]">{stats.totalRecv > 0 ? fmt(stats.totalRecv) : "0 B"}</span></span>
              <span>users <span className="text-[var(--text)]">{stats.userCount}</span></span>
            </div>
          </header>

          {/* ── Two-pane body ── */}
          <div className="flex flex-1 min-h-0">

            {/* ── Sidebar ── */}
            <div className="w-[260px] flex-shrink-0 border-r border-[var(--surface0)] flex flex-col bg-[var(--base)]">
              {/* Username */}
              <div className="p-3 border-b border-[var(--surface0)]">
                <div className="text-[0.6rem] uppercase tracking-[0.15em] text-[var(--overlay)] font-semibold mb-1.5">You</div>
                <input type="text" spellCheck={false} value={username} onChange={e => handleUsernameChange(e.target.value)}
                  placeholder="your name" className="w-full px-2.5 py-1.5 rounded-md bg-[var(--mantle)] border border-[var(--surface0)] text-[var(--text)] font-mono text-[0.8rem] outline-none focus:border-[var(--surface1)] transition-colors" />
              </div>

              {/* Room */}
              <div className="p-3 border-b border-[var(--surface0)]">
                <div className="text-[0.6rem] uppercase tracking-[0.15em] text-[var(--overlay)] font-semibold mb-1.5">Room</div>
                {room.isConnected && room.currentRoom ? (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 rounded-full bg-[var(--green)] animate-pulse" />
                      <span className="font-mono text-[0.8rem] font-semibold">{room.currentRoom}</span>
                      <span className="text-[0.65rem] text-[var(--overlay)]">{room.userCount} online</span>
                    </div>
                    {room.users.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {room.users.map(u => (
                          <span key={u} className="text-[0.65rem] font-mono px-1.5 py-0.5 rounded bg-[var(--mantle)] text-[var(--subtext)]">{u}</span>
                        ))}
                      </div>
                    )}
                    <button onClick={() => room.leaveRoom()}
                      className="text-[0.7rem] text-[var(--overlay)] hover:text-[var(--red)] transition-colors cursor-pointer">Leave</button>
                  </div>
                ) : (
                  <div>
                    <div className="flex gap-1 mb-2">
                      <input type="text" spellCheck={false} autoComplete="off" placeholder="room name"
                        value={roomInput} onChange={e => setRoomInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleJoin()}
                        className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md bg-[var(--mantle)] border border-[var(--surface0)] text-[var(--text)] font-mono text-[0.8rem] outline-none focus:border-[var(--surface1)] transition-colors" />
                      <button onClick={() => handleJoin()}
                        className="px-2.5 rounded-md bg-[var(--surface0)] text-[var(--overlay)] hover:bg-primary hover:text-primary-foreground transition-colors cursor-pointer">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                      </button>
                    </div>
                    <button onClick={() => setRoomInput(randomRoomName())}
                      className="flex items-center gap-1 text-[0.7rem] text-[var(--overlay)] hover:text-[var(--tv-accent)] transition-colors cursor-pointer mb-2">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>
                      random
                    </button>
                    <div className="space-y-0.5">
                      {(room.activeRooms.length > 0 ? room.activeRooms : SUGGESTED_ROOMS.map(n => ({ name: n, count: 0 }))).map(r => {
                        const name = typeof r === "string" ? r : r.name;
                        const count = typeof r === "string" ? 0 : r.count;
                        return (
                          <button key={name} onClick={() => handleJoin(name)}
                            className="group flex items-center gap-2 w-full px-1 py-0.5 rounded cursor-pointer hover:bg-[var(--mantle)] transition-colors text-left">
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${count > 0 ? "bg-[var(--green)]" : "bg-[var(--surface2)] group-hover:bg-[var(--tv-accent)]"} transition-colors`} />
                            <span className="font-mono text-[0.75rem] text-[var(--subtext)] group-hover:text-[var(--text)] transition-colors">{name}</span>
                            {count > 0 && <span className="text-[0.6rem] text-[var(--green)] font-mono">{count}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Codec */}
              <div className="p-3 border-b border-[var(--surface0)]">
                <div className="text-[0.6rem] uppercase tracking-[0.15em] text-[var(--overlay)] font-semibold mb-1.5">Codec</div>
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${codec.modelsLoaded ? "bg-[var(--green)]" : "bg-[var(--surface2)]"}`} />
                  <span className="text-[0.7rem] text-[var(--subtext)] font-mono">{codec.statusText}</span>
                </div>
                {codec.state === "loading" && <Progress value={codec.progress} className="mb-2 h-1.5" />}
                <button onClick={() => codec.loadModels()} disabled={codec.modelsLoaded || codec.state === "loading"}
                  className="w-full py-1.5 rounded-md text-[0.7rem] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed mb-1">
                  {codec.state === "loading" ? "Initializing..." : codec.modelsLoaded ? "Ready" : codec.modelsCached ? "Initialize Models" : "Download Models"}
                </button>
                <button onClick={() => codec.clearModelCache()}
                  className="w-full py-1 rounded-md text-[0.65rem] text-[var(--overlay)] hover:text-[var(--red)] transition-colors cursor-pointer">
                  Clear Cache
                </button>
              </div>

              {/* Spacer + bottom links */}
              <div className="flex-1" />
              <div className="p-3">
                <Sheet>
                  <SheetTrigger asChild>
                    <button className="flex items-center gap-2 text-[0.7rem] text-[var(--overlay)] hover:text-[var(--text)] transition-colors cursor-pointer mb-2 w-full">
                      <GearIcon size={14} /> Settings
                    </button>
                  </SheetTrigger>
                  <SheetContent onOpenAutoFocus={e => e.preventDefault()} className="bg-[var(--mantle)] border-[var(--surface0)] text-[var(--text)] overflow-y-auto">
                    <SheetHeader className="px-6 pt-6 pb-2"><SheetTitle className="text-[var(--text)]">Settings</SheetTitle></SheetHeader>
                    <div className="px-6 py-4"><ModelManagement /></div>
                  </SheetContent>
                </Sheet>
              </div>
            </div>

            {/* ── Main area ── */}
            <div className="flex-1 flex flex-col min-h-0 bg-[var(--mantle)]">
              {/* PTT zone */}
              <div className="flex flex-col items-center justify-center py-6 flex-shrink-0">
                <button
                  className={`relative w-[130px] h-[130px] rounded-full border-2 flex flex-col items-center justify-center gap-1 select-none touch-none transition-all duration-200 ${
                    effectiveState === "disabled"
                      ? "border-[var(--surface0)] bg-[var(--base)] text-[var(--surface2)] opacity-30 cursor-not-allowed"
                      : effectiveState === "recording"
                        ? "border-[var(--red)] bg-[var(--red)]/[0.06] text-[var(--red)] ptt-recording cursor-pointer"
                        : effectiveState === "encoding"
                          ? "border-[var(--yellow)] bg-[var(--yellow)]/[0.04] text-[var(--yellow)] cursor-wait"
                          : "border-[var(--surface1)] bg-[var(--base)] text-[var(--overlay)] hover:border-[var(--tv-accent)]/40 hover:text-[var(--tv-accent)] cursor-pointer"
                  }`}
                  onPointerDown={e => { e.preventDefault(); if (effectiveState !== "disabled") handleDown(); }}
                  onPointerUp={e => { e.preventDefault(); handleUp(); }}
                  onPointerLeave={e => { e.preventDefault(); handleUp(); }}
                >
                  {effectiveState === "recording" ? <Square className="w-7 h-7" />
                    : effectiveState === "encoding" ? <Loader2 className="w-7 h-7 animate-spin" />
                    : <Mic className="w-7 h-7" />}
                  <span className="text-[0.75rem] font-semibold tracking-widest uppercase">
                    {effectiveState === "recording" ? "RELEASE" : effectiveState === "encoding" ? "ENCODING" : "HOLD"}
                  </span>
                </button>

                {recorder.isRecording && recorder.analyserNode && (
                  <div className="mt-3"><WaveformCanvas analyserNode={recorder.analyserNode} active={recorder.isRecording} /></div>
                )}
                {!recorder.isRecording && (
                  <p className="text-[0.7rem] text-[var(--overlay)] mt-2">hold to talk &middot; release to send</p>
                )}
              </div>

              {/* Stats strip */}
              <div className="grid grid-cols-4 gap-1.5 px-4 flex-shrink-0">
                {[
                  { value: stats.bytesSent, label: "bytes sent", color: stats.bytesSent !== "\u2014" ? "text-[var(--green)]" : "" },
                  { value: stats.encodeTime, label: "encode", color: "" },
                  { value: stats.bytesRecv, label: "bytes recv", color: stats.bytesRecv !== "\u2014" ? "text-[var(--teal)]" : "" },
                  { value: stats.decodeTime, label: "decode", color: "" },
                ].map(s => (
                  <div key={s.label} className="text-center py-2 rounded-lg bg-[var(--base)] border border-[var(--surface0)]">
                    <div className={`font-mono text-[0.85rem] font-semibold ${s.color || (s.value === "\u2014" ? "text-[var(--surface2)]" : "text-[var(--text)]")}`}>{s.value}</div>
                    <div className="text-[0.6rem] text-[var(--overlay)] uppercase tracking-wider mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Activity log */}
              <div className="flex-1 min-h-0 px-4 py-3">
                <div className="h-full rounded-lg border border-[var(--surface0)] bg-[var(--base)] overflow-hidden flex flex-col">
                  <ScrollArea className="flex-1">
                    <div className="font-mono text-[0.75rem] leading-[1.8] p-3">
                      {logEntries.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-10 gap-2 text-[var(--surface2)]">
                          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-40">
                            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                            <line x1="12" x2="12" y1="19" y2="22" />
                          </svg>
                          <span className="text-[0.7rem]">Join a room & load models to start</span>
                          <span className="text-[0.55rem] opacity-50">Activity will appear here</span>
                        </div>
                      )}
                      {logEntries.map(entry => (
                        <div key={entry.id} className="log-entry">
                          {entry.message && <div className={LOG_COLORS[entry.type]}>{entry.message}</div>}
                          {entry.hexData && entry.hexType && <HexDump data={entry.hexData} type={entry.hexType} />}
                        </div>
                      ))}
                      <div ref={logEndRef} />
                    </div>
                  </ScrollArea>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ShareModal open={shareOpen} onOpenChange={setShareOpen} url={shareData.url} bytes={shareData.bytes} tokens={shareData.tokens} duration={shareData.duration} />
    </>
  );
}
