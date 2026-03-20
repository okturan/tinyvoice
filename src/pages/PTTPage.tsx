import { useState, useCallback, useRef } from "react";
import { useCodecContext } from "@/contexts/CodecContext";
import { useStats } from "@/contexts/StatsContext";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { AppShell } from "@/components/layout/AppShell";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { PTTButton, type PTTState } from "@/components/ptt/PTTButton";
import { RecordingInfo } from "@/components/ptt/RecordingInfo";
import { StatsStrip } from "@/components/ptt/StatsStrip";
import { ActivityLog, type LogEntry } from "@/components/ptt/ActivityLog";
import { ShareModal } from "@/components/ptt/ShareModal";
import { WORKER_WS, SR, type ThemeId } from "@/lib/constants";
import { randomName } from "@/lib/names";
import { fmt } from "@/lib/format";

let logIdCounter = 0;

export function PTTPage() {
  // Theme
  const [theme, setTheme] = useState<ThemeId>(() => {
    return (localStorage.getItem("fc-theme") as ThemeId) || "mocha";
  });
  const handleThemeChange = useCallback((id: ThemeId) => {
    setTheme(id);
    document.documentElement.dataset.theme = id;
    localStorage.setItem("fc-theme", id);
  }, []);

  // Username
  const [username, setUsername] = useState(
    () => localStorage.getItem("fc-username") || randomName()
  );
  const handleUsernameChange = useCallback((name: string) => {
    setUsername(name);
    localStorage.setItem("fc-username", name);
  }, []);

  // WebSocket connection state
  const [connected, setConnected] = useState(false);
  const [connectedRoom, setConnectedRoom] = useState("");
  const [connectedUsers, setConnectedUsers] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  // Log
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const addLog = useCallback(
    (
      message: string,
      type: LogEntry["type"] = "dim",
      hexData?: Uint8Array,
      hexType?: "sent" | "recv"
    ) => {
      setLogEntries((prev) => {
        const next = [
          ...prev,
          { id: ++logIdCounter, message, type, hexData, hexType },
        ];
        return next.length > 200 ? next.slice(-200) : next;
      });
    },
    []
  );

  // Codec
  const codec = useCodecContext();
  const stats = useStats();
  const recorder = useAudioRecorder();
  const player = useAudioPlayer();

  // Share modal
  const [shareOpen, setShareOpen] = useState(false);
  const [shareData, setShareData] = useState({
    url: "",
    bytes: 0,
    tokens: 0,
    duration: "",
  });

  // PTT state
  const [pttState, setPttState] = useState<PTTState>("disabled");

  // Determine if PTT is ready
  const isPttReady = codec.modelsLoaded && wsRef.current?.readyState === 1;

  // Decode incoming packet
  const handleDecode = useCallback(
    async (data: Uint8Array) => {
      stats.addRecv(data.length);
      stats.setLastRecv(data.length);
      addLog(`Received ${fmt(data.length)}`, "recv");
      addLog("", "recv", data, "recv");

      try {
        const t0 = performance.now();
        const audio = await codec.decode(data);
        const t1 = performance.now();
        const decTime = (t1 - t0) / 1000;

        addLog(
          `Decoded ${decTime.toFixed(2)}s -> ${(audio.length / SR).toFixed(1)}s`,
          "ok"
        );
        stats.setDecodeTime(decTime);
        await player.play(audio);
      } catch (e) {
        addLog(
          "Decode: " + (e instanceof Error ? e.message : String(e)),
          "warn"
        );
      }
    },
    [codec, stats, player, addLog]
  );

  // WebSocket handlers
  const joinRoom = useCallback(
    (room: string) => {
      // Cleanup existing
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
        wsRef.current = null;
      }

      addLog(`Joining "${room}"...`, "info");
      setConnectedRoom(room);

      const ws = new WebSocket(WORKER_WS + encodeURIComponent(room));
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setConnectedUsers([]);
        ws.send(JSON.stringify({ type: "hello", name: username }));
        addLog(`Joined "${room}"`, "ok");
        if (codec.modelsLoaded) {
          setPttState("idle");
        }
      };

      ws.onmessage = async (e) => {
        if (typeof e.data === "string") {
          const msg = JSON.parse(e.data);
          if (msg.type === "users") {
            stats.setUserCount(msg.count);
            setConnectedUsers(msg.names || []);
            addLog(`${msg.count} user(s) in room`, "dim");
          }
          return;
        }
        await handleDecode(new Uint8Array(e.data));
      };

      ws.onclose = () => {
        setConnected(false);
        stats.setUserCount(0);
        setPttState("disabled");
      };

      ws.onerror = () => {
        addLog("Connection error", "warn");
      };
    },
    [username, codec.modelsLoaded, stats, addLog, handleDecode]
  );

  const leaveRoom = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
    setConnected(false);
    stats.setUserCount(0);
    addLog("Left room", "dim");
    setPttState("disabled");
  }, [stats, addLog]);

  // PTT handlers
  const handlePttDown = useCallback(async () => {
    if (!isPttReady || recorder.isRecording) return;
    setPttState("recording");
    addLog("Recording...", "warn");

    try {
      await recorder.startRecording();
    } catch (e) {
      addLog(
        "Mic error: " + (e instanceof Error ? e.message : String(e)),
        "warn"
      );
      setPttState("idle");
    }
  }, [isPttReady, recorder, addLog]);

  const handlePttUp = useCallback(async () => {
    if (!recorder.isRecording) return;

    const audio = recorder.stopRecording();
    if (!audio) {
      addLog("Too short, skipped", "dim");
      setPttState("idle");
      return;
    }

    setPttState("encoding");
    // Let UI update
    await new Promise((r) => setTimeout(r, 50));

    const dur = (audio.length / SR).toFixed(1);
    addLog(`${dur}s recorded (${audio.length} samples)`, "info");

    try {
      const t0 = performance.now();
      const packet = await codec.encode(audio);
      const t1 = performance.now();
      const encTime = (t1 - t0) / 1000;

      const tokenCount = (packet.length - 1) / 2;
      addLog(
        `Encoded ${encTime.toFixed(2)}s -> ${tokenCount} tokens`,
        "ok"
      );
      stats.setEncodeTime(encTime);
      stats.setLastSent(packet.length);
      stats.addSent(packet.length);

      // Generate shareable link
      const b64 = btoa(String.fromCharCode(...packet));
      const playUrl = `${location.origin}/qr.html?v=${encodeURIComponent(b64)}`;
      addLog(`Voice link: ${packet.length}B -> ${b64.length} chars`, "dim");
      setShareData({
        url: playUrl,
        bytes: packet.length,
        tokens: tokenCount,
        duration: dur,
      });
      setShareOpen(true);

      // Send via WebSocket
      const ws = wsRef.current;
      if (ws && ws.readyState === 1) {
        ws.send(packet.buffer);
        addLog(`Sent ${fmt(packet.length)}`, "ok");
        addLog("", "ok", packet, "sent");
      }
    } catch (e) {
      addLog(
        "Encode: " + (e instanceof Error ? e.message : String(e)),
        "warn"
      );
    }

    setPttState(isPttReady ? "idle" : "disabled");
  }, [recorder, codec, stats, addLog, isPttReady]);

  // Update PTT state when codec loads
  const effectivePttState: PTTState =
    pttState === "recording" || pttState === "encoding" || pttState === "sending"
      ? pttState
      : isPttReady
        ? "idle"
        : "disabled";

  return (
    <>
      <AppShell
        header={<Header theme={theme} onThemeChange={handleThemeChange} />}
        sidebar={
          <Sidebar
            username={username}
            onUsernameChange={handleUsernameChange}
            connected={connected}
            connectedRoom={connectedRoom}
            connectedUsers={connectedUsers}
            onJoinRoom={joinRoom}
            onLeaveRoom={leaveRoom}
          />
        }
      >
        <div className="flex flex-col min-h-0 overflow-hidden">
          {/* PTT zone */}
          <div className="flex-none flex flex-col items-center justify-center relative py-6 px-3 pb-15">
            <PTTButton
              state={effectivePttState}
              onPointerDown={handlePttDown}
              onPointerUp={handlePttUp}
            />
            <RecordingInfo
              active={recorder.isRecording}
              duration={recorder.duration}
              analyserNode={recorder.analyserNode}
            />
            {!recorder.isRecording && (
              <div className="text-[0.65rem] text-[var(--overlay)] opacity-40 mt-2">
                hold to talk {"\u00b7"} release to send
              </div>
            )}
            <StatsStrip />
          </div>

          {/* Activity log */}
          <ActivityLog entries={logEntries} />
        </div>
      </AppShell>

      <ShareModal
        open={shareOpen}
        onOpenChange={setShareOpen}
        url={shareData.url}
        bytes={shareData.bytes}
        tokens={shareData.tokens}
        duration={shareData.duration}
      />
    </>
  );
}
