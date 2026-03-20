import { useState, useCallback, useEffect, useRef } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { useCodecContext } from "@/contexts/CodecContext";
import { useStats } from "@/contexts/StatsContext";
import { useRoom } from "@/contexts/RoomContext";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
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

  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [pttState, setPttState] = useState<PTTState>("disabled");
  const [roomInput, setRoomInput] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [shareData, setShareData] = useState({ url: "", bytes: 0, tokens: 0, duration: "" });

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
      <div className="min-h-screen bg-[var(--base)] text-[var(--text)] flex items-center justify-center">
        <div className="w-full max-w-[520px] flex flex-col h-[min(100vh,760px)] mx-auto my-auto">
          <TopBar />

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {/* ── Room ── */}
            {room.isConnected && room.currentRoom ? (
              <Card className="border-[var(--surface0)] bg-[var(--mantle)]">
                <CardContent className="p-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className="relative flex-shrink-0">
                      <div className="w-2.5 h-2.5 rounded-full bg-[var(--green)]" />
                      <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-[var(--green)] animate-ping opacity-30" />
                    </div>
                    <span className="font-mono text-[0.85rem] font-semibold">{room.currentRoom}</span>
                    <Badge variant="secondary" className="bg-[var(--surface0)] text-[var(--overlay)] text-[0.55rem] font-mono border-0">
                      {room.userCount} online
                    </Badge>
                    <div className="flex-1" />
                    <button
                      onClick={() => room.leaveRoom()}
                      className="text-[0.65rem] text-[var(--overlay)] hover:text-[var(--red)] transition-colors cursor-pointer"
                    >
                      Leave
                    </button>
                  </div>
                  {room.users.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2 ml-6">
                      {room.users.map(u => (
                        <span key={u} className="text-[0.55rem] font-mono px-1.5 py-0.5 rounded bg-[var(--surface0)] text-[var(--subtext)]">{u}</span>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card className="border-[var(--surface0)] bg-[var(--mantle)]">
                <CardContent className="p-3 px-4">
                  {/* Join input */}
                  <div className="text-[0.55rem] uppercase tracking-[0.15em] text-[var(--overlay)] font-semibold mb-2">Join a room</div>
                  <div className="flex gap-1.5 mb-3">
                    <div className="flex-1 flex rounded-md overflow-hidden border border-[var(--surface0)] bg-[var(--crust)] focus-within:border-[var(--surface1)] transition-colors">
                      <input
                        type="text" spellCheck={false} autoComplete="off" placeholder="enter any room name"
                        value={roomInput} onChange={e => setRoomInput(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && handleJoin()}
                        className="flex-1 min-w-0 px-2.5 py-2 bg-transparent text-[var(--text)] font-mono text-[0.8rem] outline-none placeholder:text-[var(--surface2)]"
                      />
                      <button
                        onClick={() => handleJoin()}
                        className="px-3 bg-[var(--surface0)] text-[var(--overlay)] hover:bg-primary hover:text-primary-foreground transition-colors cursor-pointer"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                      </button>
                    </div>
                    <button
                      onClick={() => setRoomInput(randomRoomName())}
                      className="px-2.5 rounded-md border border-[var(--surface0)] text-[var(--overlay)] hover:text-[var(--tv-accent)] hover:border-[var(--tv-accent)]/30 transition-colors cursor-pointer"
                      title="Generate random name"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>
                    </button>
                  </div>

                  {/* Active rooms from lobby */}
                  {room.activeRooms.length > 0 && (
                    <div className="mb-3">
                      <div className="text-[0.5rem] uppercase tracking-[0.15em] text-[var(--overlay)] mb-1.5">Active now</div>
                      <div className="flex flex-wrap gap-1">
                        {room.activeRooms.map(r => (
                          <button key={r.name} onClick={() => handleJoin(r.name)}
                            className="group flex items-center gap-1.5 px-2.5 py-1 rounded-md cursor-pointer transition-colors hover:bg-[var(--surface0)] border border-transparent hover:border-[var(--surface0)]"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] flex-shrink-0" />
                            <span className="font-mono text-[0.68rem] text-[var(--text)]">{r.name}</span>
                            <span className="text-[0.5rem] text-[var(--green)] font-mono">{r.count}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Quick join suggestions */}
                  <div>
                    <div className="text-[0.5rem] uppercase tracking-[0.15em] text-[var(--overlay)] mb-1.5">Quick join</div>
                    <div className="flex flex-wrap gap-1">
                      {SUGGESTED_ROOMS.map(name => (
                        <button key={name} onClick={() => handleJoin(name)}
                          className="group px-2.5 py-1 rounded-md cursor-pointer transition-colors hover:bg-[var(--surface0)] border border-[var(--surface0)]/50 hover:border-[var(--surface0)]"
                        >
                          <span className="font-mono text-[0.65rem] text-[var(--subtext)] group-hover:text-[var(--text)] transition-colors">{name}</span>
                        </button>
                      ))}
                    </div>
                    <p className="text-[0.5rem] text-[var(--surface2)] mt-1.5">Rooms are created on join. Anyone with the same name is connected.</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ── PTT Button ── */}
            <div className="flex flex-col items-center py-4">
              <button
                className={`relative w-[130px] h-[130px] rounded-full border-2 flex flex-col items-center justify-center gap-1 select-none touch-none transition-all duration-200 ${
                  effectiveState === "disabled"
                    ? "border-[var(--surface0)] bg-[var(--mantle)] text-[var(--surface2)] opacity-30 cursor-not-allowed"
                    : effectiveState === "recording"
                      ? "border-[var(--red)] bg-[var(--red)]/[0.06] text-[var(--red)] ptt-recording cursor-pointer"
                      : effectiveState === "encoding"
                        ? "border-[var(--yellow)] bg-[var(--yellow)]/[0.04] text-[var(--yellow)] cursor-wait"
                        : "border-[var(--surface1)] bg-[var(--mantle)] text-[var(--overlay)] hover:border-[var(--tv-accent)]/40 hover:text-[var(--tv-accent)] cursor-pointer"
                }`}
                onPointerDown={e => { e.preventDefault(); if (effectiveState !== "disabled") handleDown(); }}
                onPointerUp={e => { e.preventDefault(); handleUp(); }}
                onPointerLeave={e => { e.preventDefault(); handleUp(); }}
              >
                {effectiveState === "recording" ? <Square className="w-7 h-7" />
                  : effectiveState === "encoding" ? <Loader2 className="w-7 h-7 animate-spin" />
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
                <p className="text-[0.6rem] text-[var(--overlay)] mt-2">hold to talk &middot; release to send</p>
              )}
            </div>

            {/* ── Stats ── */}
            <div className="grid grid-cols-4 gap-1.5">
              {[
                { value: stats.bytesSent, label: "bytes sent", color: stats.bytesSent !== "\u2014" ? "text-[var(--green)]" : "" },
                { value: stats.encodeTime, label: "encode", color: "" },
                { value: stats.bytesRecv, label: "bytes recv", color: stats.bytesRecv !== "\u2014" ? "text-[var(--teal)]" : "" },
                { value: stats.decodeTime, label: "decode", color: "" },
              ].map(s => (
                <div key={s.label} className="text-center py-2 rounded-lg bg-[var(--mantle)] border border-[var(--surface0)]">
                  <div className={`font-mono text-[0.85rem] font-semibold ${s.color || "text-[var(--text)]"}`}>{s.value}</div>
                  <div className="text-[0.45rem] text-[var(--overlay)] uppercase tracking-wider mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>

            {/* ── Activity Log ── */}
            <Card className="border-[var(--surface0)] bg-[var(--mantle)] flex-1 min-h-[180px] flex flex-col overflow-hidden">
              <CardContent className="p-0 flex-1 flex flex-col overflow-hidden">
                <ScrollArea className="flex-1">
                  <div className="font-mono text-[0.65rem] leading-[1.8] p-3">
                    {logEntries.length === 0 && (
                      <div className="text-[var(--surface2)] text-center py-6">Join a room and load models to start</div>
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
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <ShareModal open={shareOpen} onOpenChange={setShareOpen} url={shareData.url} bytes={shareData.bytes} tokens={shareData.tokens} duration={shareData.duration} />
    </>
  );
}
