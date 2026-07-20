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
import { HexDump } from "@/components/ptt/HexDump";
import { HexStream } from "@/components/audio/HexStream";
import { MessageList, type VoiceMessage } from "@/components/ptt/MessageList";
import { WaveformCanvas } from "@/components/ptt/WaveformCanvas";
import { ModelDownloadDialog } from "@/components/codec/ModelDownloadDialog";
import { SettingsSheet } from "@/components/layout/SettingsSheet";
import { codec as codecService } from "@/lib/codec-service";
import { trimLeadingSilence } from "@/lib/audio/trim";
import { getTrimSilence } from "@/lib/mic-settings";
import { Quality } from "@/types/codec";
import { DEFAULT_ROOMS, QUALITY_OPTIONS, SR } from "@/lib/constants";
import { randomRoomName } from "@/lib/utils/names";
import { fmt, qualityLabel } from "@/lib/format";

type PTTState = "idle" | "recording" | "encoding" | "sending" | "disabled";

interface LogEntry {
  id: number;
  message: string;
  type: "ok" | "info" | "warn" | "dim" | "recv" | "name";
  hexData?: Uint8Array;
  hexType?: "sent" | "recv";
}

interface HexPlayback {
  id: number;
  packet: Uint8Array;
  duration: number;
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
let messageId = 0;

export function PTTPage() {
  const codec = useCodecContext();
  const stats = useStats();
  const room = useRoom();
  const recorder = useAudioRecorder();
  const { play: playAudioSamples, stop: stopAudioPlayback } = useAudioPlayer();

  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [messages, setMessages] = useState<VoiceMessage[]>([]);
  const [playingMessageId, setPlayingMessageId] = useState<number | null>(null);
  const [loadingMessageId, setLoadingMessageId] = useState<number | null>(null);
  const [pttState, setPttState] = useState<PTTState>("disabled");
  const [roomInput, setRoomInput] = useState("");
  const [newRoomQuality, setNewRoomQuality] = useState<Quality | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [openHexIds, setOpenHexIds] = useState<Set<number>>(() => new Set());
  const [hexPlayback, setHexPlayback] = useState<HexPlayback | null>(null);

  const logEndRef = useRef<HTMLDivElement>(null);
  const playbackIdRef = useRef(0);
  const playbackQueueRef = useRef<Promise<void>>(Promise.resolve());
  const playbackGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const roomQuality = (room.roomQuality as Quality | null) ?? null;
  const effectiveQuality = roomQuality ?? codec.activeQuality;
  const isPttReady =
    room.isConnected && !!effectiveQuality && codec.isQualityLoaded(effectiveQuality);
  const savedUsername = room.username.trim();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      playbackGenerationRef.current += 1;
      stopAudioPlayback();
    };
  }, [stopAudioPlayback]);

  useEffect(() => {
    playbackGenerationRef.current += 1;
    stopAudioPlayback();
    setHexPlayback(null);
    setMessages([]);
    setPlayingMessageId(null);
    setLoadingMessageId(null);
  }, [room.isConnected, room.currentRoom, stopAudioPlayback]);

  const addLog = useCallback((message: string, type: LogEntry["type"] = "dim", hexData?: Uint8Array, hexType?: "sent" | "recv") => {
    setLogEntries(prev => {
      const next = [...prev, { id: ++logId, message, type, hexData, hexType }];
      return next.length > 200 ? next.slice(-200) : next;
    });
  }, []);

  const handleUsernameChange = (v: string) => room.setUsername(v);
  const toggleHex = useCallback((id: number) => {
    setOpenHexIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ── Room events ──
  const prevConnected = useRef(room.isConnected);
  useEffect(() => {
    if (room.isConnected && !prevConnected.current && room.currentRoom) {
      addLog(`Joined "${room.currentRoom}"`, "ok");
      if (isPttReady) setPttState("idle");
    } else if (!room.isConnected && prevConnected.current) {
      addLog("Disconnected", "dim");
      setPttState("disabled");
    }
    prevConnected.current = room.isConnected;
  }, [room.isConnected, room.currentRoom, isPttReady, addLog]);

  // ── Adopt the room's locked quality ──
  useEffect(() => {
    if (!room.isConnected || !roomQuality) return;
    if (codec.activeQuality !== roomQuality) {
      codec.setActiveQuality(roomQuality);
      addLog(`Room is locked to ${qualityLabel(roomQuality)}`, "info");
    }
    if (!codec.isQualityLoaded(roomQuality) && codec.state !== "loading") {
      addLog(`Downloading ${qualityLabel(roomQuality)} models for this room...`, "info");
      codec.loadModels(roomQuality).catch((e: unknown) => {
        addLog("Model load: " + (e instanceof Error ? e.message : String(e)), "warn");
      });
    }
  }, [room.isConnected, roomQuality, codec, addLog]);

  // ── Relay rejections ──
  useEffect(
    () =>
      room.onRelayError((message) => {
        if (message.code === "quality-mismatch") {
          const label = message.quality ? qualityLabel(message.quality as Quality) : "another quality";
          addLog(`Packet dropped — room is locked to ${label}`, "warn");
        } else {
          addLog(`Relay error: ${message.code}`, "warn");
        }
      }),
    [room, addLog],
  );

  const prevUserCount = useRef(room.userCount);
  useEffect(() => {
    if (room.isConnected && room.userCount !== prevUserCount.current) {
      stats.setUserCount(room.userCount);
      addLog(`${room.userCount} user${room.userCount !== 1 ? "s" : ""} in room`, "dim");
    }
    prevUserCount.current = room.userCount;
  }, [room.isConnected, room.userCount, stats, addLog]);

  // ── Playback (incoming auto-play and message replay share this path) ──
  const playMessage = useCallback((message: VoiceMessage, { announce = false } = {}) => {
    const generation = playbackGenerationRef.current;
    const job = playbackQueueRef.current.then(async () => {
      const isCurrent = () =>
        mountedRef.current && playbackGenerationRef.current === generation;
      if (!isCurrent()) return;

      try {
        setLoadingMessageId(message.id);
        const t0 = performance.now();
        const audio = await codec.decode(message.packet);
        if (!isCurrent()) return;
        const dt = (performance.now() - t0) / 1000;
        if (announce) {
          addLog(`Decoded ${dt.toFixed(2)}s \u2192 ${(audio.length / SR).toFixed(1)}s audio`, "ok");
          stats.setDecodeTime(dt);
        }
        const duration = audio.length / SR;
        setMessages((prev) =>
          prev.map((m) => (m.id === message.id && m.duration === null ? { ...m, duration } : m)),
        );
        const playbackId = ++playbackIdRef.current;
        setHexPlayback({ id: playbackId, packet: message.packet, duration });
        setLoadingMessageId(null);
        setPlayingMessageId(message.id);
        try {
          await playAudioSamples(audio);
        } finally {
          if (isCurrent()) {
            setHexPlayback((current) => current?.id === playbackId ? null : current);
            setPlayingMessageId((current) => current === message.id ? null : current);
          }
        }
      } catch (e) {
        if (isCurrent()) {
          addLog("Decode: " + (e instanceof Error ? e.message : String(e)), "warn");
        }
      } finally {
        if (isCurrent()) {
          setLoadingMessageId((current) => current === message.id ? null : current);
        }
      }
    });

    playbackQueueRef.current = job.catch(() => {});
  }, [codec, stats, playAudioSamples, addLog]);

  const handlePlayToggle = useCallback((message: VoiceMessage) => {
    if (playingMessageId === message.id) {
      playbackGenerationRef.current += 1;
      stopAudioPlayback();
      setPlayingMessageId(null);
      setHexPlayback(null);
      return;
    }
    playMessage(message);
  }, [playingMessageId, playMessage, stopAudioPlayback]);

  // ── Decode incoming ──
  const handleDecode = useCallback((data: ArrayBuffer, sender: string | null) => {
    const packet = new Uint8Array(data);
    stats.addRecv(packet.length);
    stats.setLastRecv(packet.length);
    addLog(`Received ${fmt(packet.length)} from ${sender ?? "anon"}`, "recv", packet, "recv");

    const parsed = codecService.parsePacket(packet);
    const message: VoiceMessage = {
      id: ++messageId,
      dir: "recv",
      sender: sender ?? "anon",
      packet,
      quality: parsed?.hasMagicByte ? parsed.quality : null,
      duration: parsed
        ? codecService.estimateDuration(parsed.tokenBytes.length / 2, parsed.quality)
        : null,
      time: Date.now(),
    };
    setMessages((prev) => [...prev, message].slice(-100));
    playMessage(message, { announce: true });
  }, [stats, addLog, playMessage]);

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
    const recorded = recorder.stopRecording();
    if (!recorded) { addLog("Too short", "dim"); setPttState("idle"); return; }
    setPttState("encoding");
    await new Promise(r => setTimeout(r, 50));
    // Same persisted trim setting as the QR record surface.
    const audio = getTrimSilence() ? trimLeadingSilence(recorded, SR) : recorded;
    if (audio.length < 4096) { addLog("Too short", "dim"); setPttState("idle"); return; }
    const trimmedSec = (recorded.length - audio.length) / SR;
    const duration = audio.length / SR;
    addLog(
      `${duration.toFixed(1)}s recorded${trimmedSec > 0.05 ? ` (trimmed ${trimmedSec.toFixed(1)}s lead-in)` : ""}`,
      "info",
    );
    try {
      const t0 = performance.now();
      const packet = await codec.encode(audio, effectiveQuality ?? undefined);
      const dt = (performance.now() - t0) / 1000;
      stats.setEncodeTime(dt);
      stats.setLastSent(packet.length);
      stats.addSent(packet.length);
      addLog(`Encoded ${dt.toFixed(2)}s \u2192 ${(packet.length - 1) / 2} tokens`, "ok");
      room.sendPacket(Uint8Array.from(packet).buffer);
      addLog(`Sent ${fmt(packet.length)}`, "ok", packet, "sent");
      setMessages((prev) => [
        ...prev,
        {
          id: ++messageId,
          dir: "sent" as const,
          sender: savedUsername || "You",
          packet,
          quality: effectiveQuality,
          duration,
          time: Date.now(),
        },
      ].slice(-100));
    } catch (e) {
      addLog("Encode: " + (e instanceof Error ? e.message : String(e)), "warn");
    }
    setPttState(isPttReady ? "idle" : "disabled");
  }, [recorder, codec, stats, room, addLog, isPttReady, effectiveQuality, savedUsername]);

  const effectiveState: PTTState =
    pttState === "recording" || pttState === "encoding" || pttState === "sending"
      ? pttState : isPttReady ? "idle" : "disabled";

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logEntries]);

  // ── Room list: active rooms + the per-codec defaults not yet active ──
  const activeRoomNames = new Set(room.activeRooms.map(r => r.name));
  const listRooms = [
    ...room.activeRooms,
    ...DEFAULT_ROOMS.filter(d => !activeRoomNames.has(d.name)).map(d => ({
      name: d.name,
      count: 0,
      quality: d.quality as Quality | null,
    })),
  ];

  // A typed name that matches nothing known is a brand-new room and
  // needs an explicit codec pick before it can be created.
  const typedRoom = roomInput.trim();
  const typedDefault = DEFAULT_ROOMS.find(d => d.name === typedRoom);
  const isNewRoom = Boolean(typedRoom) && !activeRoomNames.has(typedRoom) && !typedDefault;
  const canJoinTyped = Boolean(typedRoom) && (!isNewRoom || newRoomQuality !== null);

  const handleJoin = (name?: string, quality?: Quality) => {
    const candidate = name ?? typedRoom;
    if (!candidate) return;
    let resolved = quality;
    if (name === undefined) {
      // Joining from the input: known rooms bring their own codec,
      // new rooms require the picker.
      if (typedDefault) resolved = typedDefault.quality;
      else if (isNewRoom) {
        if (!newRoomQuality) return;
        resolved = newRoomQuality;
      }
    }
    if (!room.joinRoom(candidate, resolved)) {
      addLog("Invalid room name", "warn");
      return;
    }
    setNewRoomQuality(null);
  };

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
                <input type="text" spellCheck={false} value={room.username} onChange={e => handleUsernameChange(e.target.value)}
                  maxLength={64} placeholder="your name" className="w-full px-2.5 py-1.5 rounded-md bg-[var(--mantle)] border border-[var(--surface0)] text-[var(--text)] font-mono text-[0.8rem] outline-none focus:border-[var(--surface1)] transition-colors" />
                <div className="mt-1 text-[0.6rem] text-[var(--overlay)]">
                  {savedUsername
                    ? room.isConnected ? `Visible as ${savedUsername}` : `Saved as ${savedUsername}`
                    : "Using anon"}
                </div>
              </div>

              {/* Room */}
              <div className="p-3 border-b border-[var(--surface0)]">
                <div className="text-[0.6rem] uppercase tracking-[0.15em] text-[var(--overlay)] font-semibold mb-1.5">Room</div>
                {room.isConnected && room.currentRoom ? (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 rounded-full bg-[var(--green)] animate-pulse" />
                      <span className="font-mono text-[0.8rem] font-semibold">{room.currentRoom}</span>
                      {roomQuality && (
                        <span className="text-[0.6rem] font-mono px-1.5 py-0.5 rounded bg-[var(--mantle)] text-[var(--tv-accent)]">{qualityLabel(roomQuality)}</span>
                      )}
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
                        maxLength={128} value={roomInput} onChange={e => { setRoomInput(e.target.value); setNewRoomQuality(null); }} onKeyDown={e => e.key === "Enter" && canJoinTyped && handleJoin()}
                        className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md bg-[var(--mantle)] border border-[var(--surface0)] text-[var(--text)] font-mono text-[0.8rem] outline-none focus:border-[var(--surface1)] transition-colors" />
                      <button onClick={() => handleJoin()} disabled={!canJoinTyped}
                        title={isNewRoom && !newRoomQuality ? "Pick a codec for the new room first" : "Join"}
                        className="px-2.5 rounded-md bg-[var(--surface0)] text-[var(--overlay)] hover:bg-primary hover:text-primary-foreground transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-[var(--surface0)] disabled:hover:text-[var(--overlay)]">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                      </button>
                    </div>
                    {isNewRoom && (
                      <div className="mb-2">
                        <div className="text-[0.58rem] text-[var(--overlay)] mb-1">New room — pick its codec:</div>
                        <div className="flex gap-1">
                          {QUALITY_OPTIONS.map(opt => (
                            <button key={opt.value} onClick={() => setNewRoomQuality(opt.value)}
                              className={`flex-1 py-1 rounded-md text-[0.65rem] font-mono transition-colors cursor-pointer ${
                                newRoomQuality === opt.value
                                  ? "bg-[var(--surface0)] font-semibold text-[var(--text)]"
                                  : "text-[var(--overlay)] hover:bg-[var(--mantle)] hover:text-[var(--subtext)]"
                              }`}>
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <button onClick={() => setRoomInput(randomRoomName())}
                      className="flex items-center gap-1 text-[0.7rem] text-[var(--overlay)] hover:text-[var(--tv-accent)] transition-colors cursor-pointer mb-2">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>
                      random
                    </button>
                    <div className="space-y-0.5">
                      {listRooms.map(r => (
                        <button key={r.name} onClick={() => handleJoin(r.name, (r.quality as Quality | null) ?? undefined)}
                          className="group flex items-center gap-2 w-full px-1 py-0.5 rounded cursor-pointer hover:bg-[var(--mantle)] transition-colors text-left">
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${r.count > 0 ? "bg-[var(--green)]" : "bg-[var(--surface2)] group-hover:bg-[var(--tv-accent)]"} transition-colors`} />
                          <span className="font-mono text-[0.75rem] text-[var(--subtext)] group-hover:text-[var(--text)] transition-colors">{r.name}</span>
                          {r.count > 0 && <span className="text-[0.6rem] text-[var(--green)] font-mono">{r.count}</span>}
                          {r.quality && (
                            <span className={`ml-auto text-[0.55rem] font-mono px-1.5 py-px rounded ${
                              r.count > 0
                                ? "bg-[var(--mantle)] text-[var(--tv-accent)]"
                                : "bg-[var(--mantle)] text-[var(--overlay)] group-hover:text-[var(--subtext)]"
                            }`}>{qualityLabel(r.quality as Quality)}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Codec */}
              <div className="p-3 border-b border-[var(--surface0)]">
                <div className="text-[0.6rem] uppercase tracking-[0.15em] text-[var(--overlay)] font-semibold mb-1.5">Codec</div>
                <div className="flex gap-1 mb-1.5">
                  {QUALITY_OPTIONS.map(opt => {
                    const active = effectiveQuality === opt.value;
                    const loaded = codec.isQualityLoaded(opt.value);
                    const locked = room.isConnected && !!roomQuality && opt.value !== roomQuality;
                    return (
                      <button
                        key={opt.value}
                        disabled={locked || codec.state === "loading"}
                        title={locked ? "Room locks quality" : loaded ? `Encode with ${opt.label}` : `Download & use ${opt.label}`}
                        onClick={() => {
                          if (loaded) codec.setActiveQuality(opt.value);
                          else codec.loadModels(opt.value).then(ok => { if (ok) codec.setActiveQuality(opt.value); }).catch(() => {});
                        }}
                        className={`flex-1 py-1 rounded-md text-[0.65rem] font-mono transition-colors ${
                          active
                            ? "bg-[var(--surface0)] font-semibold text-[var(--text)]"
                            : locked
                              ? "text-[var(--surface2)] cursor-not-allowed"
                              : "text-[var(--overlay)] hover:bg-[var(--mantle)] hover:text-[var(--subtext)] cursor-pointer"
                        }`}
                      >
                        {opt.label}{loaded ? "" : " ↓"}
                      </button>
                    );
                  })}
                </div>
                {room.isConnected && roomQuality && (
                  <div className="text-[0.58rem] text-[var(--overlay)] mb-1.5">Quality locked by room</div>
                )}
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${codec.modelsLoaded ? "bg-[var(--green)]" : "bg-[var(--surface2)]"}`} />
                  <span className="text-[0.7rem] text-[var(--subtext)] font-mono">{codec.statusText}</span>
                </div>
                {codec.state === "loading" && <Progress value={codec.progress} className="mb-2 h-1.5" />}
                <button onClick={() => setDownloadOpen(true)} disabled={codec.state === "loading"}
                  className="w-full py-1.5 rounded-md text-[0.7rem] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed mb-1">
                  {codec.state === "loading" ? "Loading models..." : codec.modelsLoaded ? "Change models" : "Choose models"}
                </button>
                {codec.state === "loading" && (
                  <button onClick={codec.abortLoading}
                    className="w-full py-1 rounded-md text-[0.65rem] text-[var(--overlay)] hover:text-[var(--red)] transition-colors cursor-pointer mb-1">
                    Cancel download
                  </button>
                )}
                {clearConfirm ? (
                  <div className="flex gap-1.5 mt-1">
                    <button onClick={() => { codec.clearModelCache(); setClearConfirm(false); }}
                      className="flex-1 py-1 rounded-md text-[0.65rem] font-medium text-[var(--red)] bg-[color-mix(in_srgb,var(--red)_10%,var(--surface0))] hover:bg-[color-mix(in_srgb,var(--red)_20%,var(--surface0))] transition-colors cursor-pointer">
                      Yes, delete models
                    </button>
                    <button onClick={() => setClearConfirm(false)}
                      className="flex-1 py-1 rounded-md text-[0.65rem] text-[var(--overlay)] bg-[var(--surface0)] hover:bg-[var(--surface1)] transition-colors cursor-pointer">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setClearConfirm(true)}
                    className="w-full py-1 rounded-md text-[0.65rem] text-[var(--overlay)] hover:text-[var(--red)] transition-colors cursor-pointer">
                    Delete downloaded models
                  </button>
                )}
              </div>

              {/* Spacer + bottom links */}
              <div className="flex-1" />
              <div className="p-3">
                <button
                  onClick={() => setSettingsOpen(true)}
                  className="flex items-center gap-2 text-[0.7rem] text-[var(--overlay)] hover:text-[var(--text)] transition-colors cursor-pointer mb-2 w-full"
                >
                  <GearIcon size={14} /> Settings
                </button>
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

              {hexPlayback && (
                <div className="px-4 pb-3 flex-shrink-0">
                  <HexStream
                    data={hexPlayback.packet}
                    active
                    duration={hexPlayback.duration}
                    label="Token data"
                  />
                </div>
              )}

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

              {/* Voice messages */}
              <div className="flex-1 min-h-0 px-4 pt-3">
                <div className="h-full rounded-lg border border-[var(--surface0)] bg-[var(--base)] overflow-hidden">
                  <MessageList
                    messages={messages}
                    playingId={playingMessageId}
                    loadingId={loadingMessageId}
                    onPlay={handlePlayToggle}
                  />
                </div>
              </div>

              {/* Diagnostics (demoted activity log) */}
              <div className="px-4 py-2 flex-shrink-0">
                <button
                  onClick={() => setDiagnosticsOpen(o => !o)}
                  className="flex items-center gap-1.5 text-[0.62rem] font-mono text-[var(--overlay)] hover:text-[var(--subtext)] transition-colors cursor-pointer"
                >
                  <span className={`inline-block text-[0.5rem] transition-transform ${diagnosticsOpen ? "rotate-90" : ""}`}>{"\u25b8"}</span>
                  Diagnostics {"\u00b7"} {logEntries.length}
                </button>
                {diagnosticsOpen && (
                  <div className="mt-1.5 h-36 rounded-lg border border-[var(--surface0)] bg-[var(--base)] overflow-hidden">
                    <ScrollArea className="h-full">
                      <div className="font-mono text-[0.7rem] leading-[1.8] p-2.5">
                        {logEntries.length === 0 && (
                          <span className="text-[var(--surface2)]">No activity yet</span>
                        )}
                        {logEntries.map(entry => (
                          <div key={entry.id} className="log-entry">
                            {entry.message && (
                              <div
                                className={`${LOG_COLORS[entry.type]} ${entry.hexData ? "cursor-pointer select-none" : ""}`}
                                onClick={() => entry.hexData && toggleHex(entry.id)}
                              >
                                {entry.hexData && (
                                  <span className={`mr-1 inline-block text-[0.55rem] text-[var(--overlay)] transition-transform ${openHexIds.has(entry.id) ? "rotate-90" : ""}`}>
                                    {"\u25b8"}
                                  </span>
                                )}
                                {entry.message}
                              </div>
                            )}
                            {entry.hexData && entry.hexType && (
                              <HexDump
                                data={entry.hexData}
                                type={entry.hexType}
                                open={openHexIds.has(entry.id)}
                                showTrigger={false}
                              />
                            )}
                          </div>
                        ))}
                        <div ref={logEndRef} />
                      </div>
                    </ScrollArea>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <ModelDownloadDialog
        open={downloadOpen}
        onOpenChange={setDownloadOpen}
      />
      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
