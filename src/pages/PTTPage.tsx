import { useState, useCallback, useEffect, useRef } from "react";
import { useCodecContext } from "@/contexts/CodecContext";
import { useStats } from "@/contexts/StatsContext";
import { useRoom } from "@/contexts/RoomContext";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { TopBar } from "@/components/ptt/TopBar";
import { SettingsSheet } from "@/components/ptt/SettingsSheet";
import { ConnectionPanel } from "@/components/ptt/ConnectionPanel";
import { PTTButton, type PTTState } from "@/components/ptt/PTTButton";
import { RecordingInfo } from "@/components/ptt/RecordingInfo";
import { StatsStrip } from "@/components/ptt/StatsStrip";
import { ActivityLog, type LogEntry } from "@/components/ptt/ActivityLog";
import { ShareModal } from "@/components/ptt/ShareModal";
import { SR } from "@/lib/constants";
import { fmt } from "@/lib/format";

let logIdCounter = 0;

export function PTTPage() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Contexts
  const codec = useCodecContext();
  const stats = useStats();
  const room = useRoom();
  const recorder = useAudioRecorder();
  const player = useAudioPlayer();

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
  const isPttReady = codec.modelsLoaded && room.isConnected;

  // Decode incoming packet
  const handleDecode = useCallback(
    async (data: ArrayBuffer) => {
      const packet = new Uint8Array(data);
      stats.addRecv(packet.length);
      stats.setLastRecv(packet.length);
      addLog(`Received ${fmt(packet.length)}`, "recv");
      addLog("", "recv", packet, "recv");

      try {
        const t0 = performance.now();
        const audio = await codec.decode(packet);
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

  // Register packet handler with RoomContext
  useEffect(() => {
    const unsubscribe = room.onPacketReceived(handleDecode);
    return unsubscribe;
  }, [room, handleDecode]);

  // Log room events
  const prevConnected = useRef(room.isConnected);
  const prevRoom = useRef(room.currentRoom);
  const prevUserCount = useRef(room.userCount);

  useEffect(() => {
    if (room.isConnected && !prevConnected.current && room.currentRoom) {
      addLog(`Joined "${room.currentRoom}"`, "ok");
      if (codec.modelsLoaded) {
        setPttState("idle");
      }
    } else if (!room.isConnected && prevConnected.current) {
      addLog("Left room", "dim");
      setPttState("disabled");
    }
    prevConnected.current = room.isConnected;
    prevRoom.current = room.currentRoom;
  }, [room.isConnected, room.currentRoom, codec.modelsLoaded, addLog]);

  useEffect(() => {
    if (room.isConnected && room.userCount !== prevUserCount.current) {
      stats.setUserCount(room.userCount);
      addLog(`${room.userCount} user(s) in room`, "dim");
    }
    prevUserCount.current = room.userCount;
  }, [room.isConnected, room.userCount, stats, addLog]);

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
      const playUrl = `${location.origin}/qr?v=${encodeURIComponent(b64)}`;
      addLog(`Voice link: ${packet.length}B -> ${b64.length} chars`, "dim");
      setShareData({
        url: playUrl,
        bytes: packet.length,
        tokens: tokenCount,
        duration: dur,
      });
      setShareOpen(true);

      // Send via RoomContext
      room.sendPacket(packet.buffer);
      addLog(`Sent ${fmt(packet.length)}`, "ok");
      addLog("", "ok", packet, "sent");
    } catch (e) {
      addLog(
        "Encode: " + (e instanceof Error ? e.message : String(e)),
        "warn"
      );
    }

    setPttState(isPttReady ? "idle" : "disabled");
  }, [recorder, codec, stats, room, addLog, isPttReady]);

  // Update PTT state when codec loads or connection changes
  const effectivePttState: PTTState =
    pttState === "recording" || pttState === "encoding" || pttState === "sending"
      ? pttState
      : isPttReady
        ? "idle"
        : "disabled";

  return (
    <>
      <div className="min-h-screen bg-[var(--base)] text-[var(--text)]">
        <div className="max-w-[520px] mx-auto flex flex-col min-h-screen">
          {/* Top Bar */}
          <TopBar onSettingsOpen={() => setSettingsOpen(true)} />

          {/* Connection Panel */}
          <div className="px-3 pt-3">
            <ConnectionPanel />
          </div>

          {/* PTT Zone */}
          <div className="flex-none flex flex-col items-center justify-center py-6 px-3">
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

            {/* Stats Row */}
            <div className="w-full mt-4">
              <StatsStrip />
            </div>
          </div>

          {/* Activity Log */}
          <div className="flex-1 min-h-0 px-3 pb-3">
            <ActivityLog entries={logEntries} />
          </div>
        </div>
      </div>

      {/* Settings Sheet */}
      <SettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />

      {/* Share Modal */}
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
