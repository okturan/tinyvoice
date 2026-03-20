import { useState, useCallback, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Settings, Mic, Square, Loader2, Radio, Shuffle, ArrowRight, LogOut } from "lucide-react";
import { useCodecContext } from "@/contexts/CodecContext";
import { useStats } from "@/contexts/StatsContext";
import { useRoom } from "@/contexts/RoomContext";
import { useThemeContext } from "@/contexts/ThemeContext";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ShareModal } from "@/components/ptt/ShareModal";
import { HexDump } from "@/components/ptt/HexDump";
import { WaveformCanvas } from "@/components/ptt/WaveformCanvas";
import { SR, SUGGESTED_ROOMS } from "@/lib/constants";
import { randomRoomName } from "@/lib/names";
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
  const { theme, setTheme, themes } = useThemeContext();

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

  // ── Room events ──
  const prevConnected = useRef(room.isConnected);
  useEffect(() => {
    if (room.isConnected && !prevConnected.current && room.currentRoom) {
      addLog(`tuned to "${room.currentRoom}"`, "ok");
      if (codec.modelsLoaded) setPttState("idle");
    } else if (!room.isConnected && prevConnected.current) {
      addLog("disconnected", "dim");
      setPttState("disabled");
    }
    prevConnected.current = room.isConnected;
  }, [room.isConnected, room.currentRoom, codec.modelsLoaded, addLog]);

  const prevUserCount = useRef(room.userCount);
  useEffect(() => {
    if (room.isConnected && room.userCount !== prevUserCount.current) {
      stats.setUserCount(room.userCount);
      addLog(`${room.userCount} station${room.userCount !== 1 ? "s" : ""} online`, "dim");
    }
    prevUserCount.current = room.userCount;
  }, [room.isConnected, room.userCount, stats, addLog]);

  // ── Decode incoming ──
  const handleDecode = useCallback(async (data: ArrayBuffer) => {
    const packet = new Uint8Array(data);
    stats.addRecv(packet.length);
    stats.setLastRecv(packet.length);
    addLog(`received ${fmt(packet.length)}`, "recv");
    try {
      const t0 = performance.now();
      const audio = await codec.decode(packet);
      const dt = (performance.now() - t0) / 1000;
      addLog(`decoded ${dt.toFixed(2)}s → ${(audio.length / SR).toFixed(1)}s audio`, "ok");
      stats.setDecodeTime(dt);
      await player.play(audio);
    } catch (e) {
      addLog("decode: " + (e instanceof Error ? e.message : String(e)), "warn");
    }
  }, [codec, stats, player, addLog]);

  useEffect(() => room.onPacketReceived(handleDecode), [room, handleDecode]);

  // ── PTT handlers ──
  const handleDown = useCallback(async () => {
    if (!isPttReady || recorder.isRecording) return;
    setPttState("recording");
    addLog("transmitting...", "warn");
    try {
      await recorder.startRecording();
    } catch (e) {
      addLog("mic: " + (e instanceof Error ? e.message : String(e)), "warn");
      setPttState("idle");
    }
  }, [isPttReady, recorder, addLog]);

  const handleUp = useCallback(async () => {
    if (!recorder.isRecording) return;
    const audio = recorder.stopRecording();
    if (!audio) { addLog("too short", "dim"); setPttState("idle"); return; }
    setPttState("encoding");
    await new Promise(r => setTimeout(r, 50));
    const dur = (audio.length / SR).toFixed(1);
    addLog(`${dur}s captured`, "info");
    try {
      const t0 = performance.now();
      const packet = await codec.encode(audio);
      const dt = (performance.now() - t0) / 1000;
      stats.setEncodeTime(dt);
      stats.setLastSent(packet.length);
      stats.addSent(packet.length);
      addLog(`encoded ${dt.toFixed(2)}s → ${(packet.length - 1) / 2} tokens`, "ok");
      const b64 = btoa(String.fromCharCode(...packet));
      setShareData({ url: `${location.origin}/qr?v=${encodeURIComponent(b64)}`, bytes: packet.length, tokens: (packet.length - 1) / 2, duration: dur });
      setShareOpen(true);
      room.sendPacket(packet.buffer);
      addLog(`transmitted ${fmt(packet.length)}`, "ok");
    } catch (e) {
      addLog("encode: " + (e instanceof Error ? e.message : String(e)), "warn");
    }
    setPttState(isPttReady ? "idle" : "disabled");
  }, [recorder, codec, stats, room, addLog, isPttReady]);

  const effectiveState: PTTState =
    pttState === "recording" || pttState === "encoding" || pttState === "sending"
      ? pttState : isPttReady ? "idle" : "disabled";

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logEntries]);

  const handleJoin = (name?: string) => {
    const r = name || roomInput.trim();
    if (r) room.joinRoom(r);
  };

  const handleUsernameChange = (v: string) => {
    setUsername(v);
    localStorage.setItem("fc-username", v);
  };

  return (
    <>
      <div className="noise min-h-screen bg-[var(--base)] text-[var(--text)] relative flex items-center justify-center">
        <div className="relative z-10 w-full max-w-[480px] flex flex-col h-[min(100vh,760px)] mx-auto my-auto">

          {/* ── Top Bar ── */}
          <header className="flex items-center h-11 px-4 border-b border-[var(--surface0)]/50 bg-[var(--mantle)]/60 backdrop-blur-sm flex-shrink-0">
            <div className="flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-[var(--tv-accent)]" />
              <span className="text-[0.8rem] font-semibold tracking-tight">TinyVoice</span>
            </div>

            <nav className="flex-1 flex justify-center gap-0.5">
              <span className="px-2.5 py-0.5 rounded text-[0.6rem] font-semibold tracking-widest uppercase bg-[var(--tv-accent)]/12 text-[var(--tv-accent)] border border-[var(--tv-accent)]/20">
                PTT
              </span>
              <Link
                to="/qr"
                className="px-2.5 py-0.5 rounded text-[0.6rem] font-semibold tracking-widest uppercase text-[var(--overlay)] hover:text-[var(--subtext)] hover:bg-[var(--surface0)]/50 transition-colors no-underline"
              >
                QR
              </Link>
            </nav>

            <div className="flex items-center gap-1.5">
              {themes.map(t => (
                <Tooltip key={t.id}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setTheme(t.id)}
                      className="w-2.5 h-2.5 rounded-full cursor-pointer transition-all duration-200 hover:scale-125"
                      style={{
                        background: t.swatch,
                        boxShadow: theme === t.id
                          ? `0 0 0 1.5px var(--base), 0 0 0 3px ${t.swatch}`
                          : t.id === "midnight" ? "inset 0 0 0 1px rgba(255,255,255,0.15)" : "none",
                      }}
                    />
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[0.6rem] font-mono">{t.label}</TooltipContent>
                </Tooltip>
              ))}

              <Sheet>
                <SheetTrigger asChild>
                  <button className="ml-1 p-1 rounded text-[var(--overlay)] hover:text-[var(--subtext)] hover:bg-[var(--surface0)]/50 transition-colors cursor-pointer">
                    <Settings className="w-3.5 h-3.5" />
                  </button>
                </SheetTrigger>
                <SheetContent className="bg-[var(--mantle)] border-[var(--surface0)] text-[var(--text)] w-[320px]">
                  <SheetHeader>
                    <SheetTitle className="text-[var(--text)] text-sm font-semibold">Settings</SheetTitle>
                  </SheetHeader>
                  <div className="mt-4 space-y-4">
                    <div>
                      <label className="text-[0.6rem] uppercase tracking-widest text-[var(--overlay)] font-semibold">Callsign</label>
                      <input
                        type="text"
                        value={username}
                        onChange={e => handleUsernameChange(e.target.value)}
                        placeholder="anonymous"
                        className="w-full mt-1 px-3 py-2 rounded-md bg-[var(--crust)] border border-[var(--surface0)] text-[var(--text)] font-mono text-[0.8rem] outline-none focus:border-[var(--tv-accent)]/50 transition-colors"
                      />
                    </div>
                    <Separator className="bg-[var(--surface0)]" />
                    <div>
                      <label className="text-[0.6rem] uppercase tracking-widest text-[var(--overlay)] font-semibold">Codec</label>
                      <div className="mt-2 flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full ${codec.modelsLoaded ? "bg-[var(--green)] glow-green" : "bg-[var(--surface2)]"}`} />
                        <span className="text-[0.7rem] text-[var(--subtext)] font-mono">{codec.statusText}</span>
                      </div>
                      {codec.state === "loading" && <Progress value={codec.progress} className="mt-2 h-1" />}
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => codec.loadModels()}
                          disabled={codec.modelsLoaded || codec.state === "loading"}
                          className="flex-1 py-1.5 rounded-md text-[0.65rem] font-semibold bg-[var(--tv-accent)]/10 text-[var(--tv-accent)] border border-[var(--tv-accent)]/15 hover:bg-[var(--tv-accent)]/18 disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed"
                        >
                          {codec.state === "loading" ? "Loading..." : "Load Models"}
                        </button>
                        <button
                          onClick={() => codec.clearModelCache()}
                          className="py-1.5 px-3 rounded-md text-[0.65rem] text-[var(--overlay)] border border-[var(--surface0)] hover:text-[var(--red)] hover:border-[var(--red)]/20 transition-colors cursor-pointer"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </header>

          {/* ── Connection ── */}
          <div className="px-3 pt-3">
            {room.isConnected && room.currentRoom ? (
              /* Connected state */
              <div className="rounded-lg border border-[var(--green)]/15 bg-[var(--green)]/[0.03] p-3">
                <div className="flex items-center gap-3">
                  <div className="relative flex-shrink-0">
                    <div className="w-2 h-2 rounded-full bg-[var(--green)] glow-green" />
                    <div className="absolute inset-0 w-2 h-2 rounded-full bg-[var(--green)] animate-[beacon_2s_ease-in-out_infinite]" />
                  </div>
                  <span className="font-mono text-[0.8rem] font-medium text-[var(--text)]">{room.currentRoom}</span>
                  <span className="text-[0.55rem] text-[var(--overlay)] font-mono">{room.userCount} online</span>
                  <div className="flex-1" />
                  <button
                    onClick={() => room.leaveRoom()}
                    className="p-1 rounded text-[var(--overlay)] hover:text-[var(--red)] transition-colors cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                </div>
                {room.users.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2 ml-5">
                    {room.users.map(u => (
                      <span key={u} className="text-[0.55rem] font-mono px-1.5 py-0.5 rounded bg-[var(--surface0)]/50 text-[var(--subtext)]">{u}</span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* Disconnected state */
              <div className="space-y-2">
                <div className="flex gap-1">
                  <div className="flex-1 flex rounded-md overflow-hidden border border-[var(--surface0)] bg-[var(--crust)] focus-within:border-[var(--surface1)] transition-colors">
                    <input
                      type="text"
                      spellCheck={false}
                      autoComplete="off"
                      placeholder="frequency"
                      value={roomInput}
                      onChange={e => setRoomInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleJoin()}
                      className="flex-1 min-w-0 px-2.5 py-1.5 bg-transparent text-[var(--text)] font-mono text-[0.75rem] outline-none placeholder:text-[var(--surface2)]"
                    />
                    <button
                      onClick={() => handleJoin()}
                      className="px-2.5 bg-[var(--surface0)]/50 text-[var(--overlay)] hover:bg-[var(--tv-accent)] hover:text-[var(--crust)] transition-colors cursor-pointer"
                    >
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <button
                    onClick={() => setRoomInput(randomRoomName())}
                    className="px-2 rounded-md border border-[var(--surface0)] text-[var(--overlay)] hover:text-[var(--tv-accent)] hover:border-[var(--tv-accent)]/20 transition-colors cursor-pointer"
                  >
                    <Shuffle className="w-3 h-3" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {(room.activeRooms.length > 0 ? room.activeRooms : SUGGESTED_ROOMS.map(n => ({ name: n, count: 0 }))).map(r => {
                    const name = typeof r === "string" ? r : r.name;
                    const count = typeof r === "string" ? 0 : r.count;
                    return (
                      <button
                        key={name}
                        onClick={() => handleJoin(name)}
                        className="group flex items-center gap-1 px-2 py-0.5 rounded text-[0.6rem] font-mono text-[var(--overlay)] hover:text-[var(--text)] hover:bg-[var(--surface0)]/40 transition-colors cursor-pointer"
                      >
                        <span className={`w-1 h-1 rounded-full ${count > 0 ? "bg-[var(--green)]" : "bg-[var(--surface2)] group-hover:bg-[var(--tv-accent)]"} transition-colors`} />
                        {name}
                        {count > 0 && <span className="text-[0.5rem] text-[var(--green)]">{count}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ── PTT Zone ── */}
          <div className="flex flex-col items-center justify-center py-8 px-4">
            <button
              className={`relative w-[140px] h-[140px] rounded-full border-2 flex flex-col items-center justify-center gap-1 select-none touch-none transition-all duration-200 ${
                effectiveState === "disabled"
                  ? "border-[var(--surface0)] bg-[var(--mantle)] text-[var(--surface2)] opacity-30 cursor-not-allowed"
                  : effectiveState === "recording"
                    ? "border-[var(--red)] bg-[var(--red)]/[0.06] text-[var(--red)] ptt-recording cursor-pointer"
                    : effectiveState === "encoding"
                      ? "border-[var(--yellow)] bg-[var(--yellow)]/[0.04] text-[var(--yellow)] cursor-wait"
                      : "border-[var(--surface1)] bg-[var(--mantle)] text-[var(--overlay)] hover:border-[var(--tv-accent)]/40 hover:text-[var(--tv-accent)] hover:bg-[var(--tv-accent)]/[0.03] cursor-pointer glow"
              }`}
              onPointerDown={e => { e.preventDefault(); if (effectiveState !== "disabled") handleDown(); }}
              onPointerUp={e => { e.preventDefault(); handleUp(); }}
              onPointerLeave={e => { e.preventDefault(); handleUp(); }}
            >
              {effectiveState === "recording" && (
                <div className="absolute inset-0 rounded-full border border-[var(--red)]/20 animate-ping" />
              )}
              {effectiveState === "recording"
                ? <Square className="w-7 h-7" />
                : effectiveState === "encoding"
                  ? <Loader2 className="w-7 h-7 animate-spin" />
                  : <Mic className="w-7 h-7" />}
              <span className="text-[0.65rem] font-semibold tracking-widest uppercase">
                {effectiveState === "recording" ? "RELEASE" : effectiveState === "encoding" ? "ENCODING" : "HOLD"}
              </span>
            </button>

            {recorder.isRecording && recorder.analyserNode && (
              <div className="mt-3">
                <WaveformCanvas analyserNode={recorder.analyserNode} active={recorder.isRecording} />
              </div>
            )}

            {!recorder.isRecording && (
              <p className="text-[0.55rem] text-[var(--overlay)]/50 mt-2 tracking-wider">
                hold to talk &middot; release to send
              </p>
            )}

            {/* Stats */}
            <div className="grid grid-cols-4 gap-1.5 w-full mt-5">
              {[
                { value: stats.bytesSent, label: "TX", color: stats.bytesSent !== "\u2014" ? "text-[var(--green)]" : "" },
                { value: stats.encodeTime, label: "ENC", color: "" },
                { value: stats.bytesRecv, label: "RX", color: stats.bytesRecv !== "\u2014" ? "text-[var(--teal)]" : "" },
                { value: stats.decodeTime, label: "DEC", color: "" },
              ].map(s => (
                <div key={s.label} className="text-center py-1.5 rounded bg-[var(--mantle)]/60 border border-[var(--surface0)]/40">
                  <div className={`font-mono text-[0.8rem] font-medium ${s.color || "text-[var(--subtext)]"}`}>{s.value}</div>
                  <div className="text-[0.4rem] text-[var(--overlay)] uppercase tracking-[0.2em] mt-0.5 font-semibold">{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Activity Log ── */}
          <div className="flex-1 min-h-[120px] px-3 pb-3 overflow-hidden">
            <div className="h-full rounded-lg border border-[var(--surface0)]/30 bg-[var(--mantle)]/40 backdrop-blur-sm overflow-hidden flex flex-col relative scanlines">
              <div className="px-3 py-1.5 border-b border-[var(--surface0)]/30 flex items-center gap-1.5">
                <div className="w-1 h-1 rounded-full bg-[var(--green)]" />
                <span className="text-[0.5rem] text-[var(--overlay)] uppercase tracking-[0.2em] font-semibold">Transmission Log</span>
              </div>
              <ScrollArea className="flex-1 min-h-0 relative z-10">
                <div className="font-mono text-[0.65rem] leading-[1.8] px-3 py-2">
                  {logEntries.length === 0 && (
                    <div className="text-[var(--surface2)] text-center py-6">
                      tune to a frequency to begin
                    </div>
                  )}
                  {logEntries.map(entry => (
                    <div key={entry.id} className="log-entry">
                      {entry.message && (
                        <div className={`${LOG_COLORS[entry.type]} flex items-start gap-1.5`}>
                          <span className="text-[var(--surface2)] select-none">&gt;</span>
                          <span>{entry.message}</span>
                        </div>
                      )}
                      {entry.hexData && entry.hexType && (
                        <HexDump data={entry.hexData} type={entry.hexType} />
                      )}
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              </ScrollArea>
            </div>
          </div>
        </div>
      </div>

      <ShareModal open={shareOpen} onOpenChange={setShareOpen} url={shareData.url} bytes={shareData.bytes} tokens={shareData.tokens} duration={shareData.duration} />
    </>
  );
}
