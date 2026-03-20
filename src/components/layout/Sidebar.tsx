import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useCodecContext } from "@/contexts/CodecContext";
import { RELAY_HTTP, SUGGESTED_ROOMS } from "@/lib/constants";
import { randomRoomName } from "@/lib/names";
import { getRecentRooms, addRecentRoom } from "@/lib/rooms";
import { CodecStatus } from "@/components/codec/CodecStatus";
import { ModelProgress } from "@/components/codec/ModelProgress";
import { Button } from "@/components/ui/button";

export interface RoomInfo {
  name: string;
  count: number;
}

interface SidebarProps {
  username: string;
  onUsernameChange: (name: string) => void;
  connected: boolean;
  connectedRoom: string;
  connectedUsers: string[];
  onJoinRoom: (room: string) => void;
  onLeaveRoom: () => void;
}

export function Sidebar({
  username,
  onUsernameChange,
  connected,
  connectedRoom,
  connectedUsers,
  onJoinRoom,
  onLeaveRoom,
}: SidebarProps) {
  const codec = useCodecContext();
  const [roomInput, setRoomInput] = useState(() => {
    const recent = getRecentRooms();
    return recent[0] || "odin";
  });
  const [liveRooms, setLiveRooms] = useState<RoomInfo[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRooms = useCallback(async () => {
    try {
      const res = await fetch(RELAY_HTTP + "/rooms");
      const active: RoomInfo[] = await res.json();
      setLiveRooms(active);
    } catch {
      setLiveRooms([]);
    }
  }, []);

  // Poll rooms when in lobby
  useEffect(() => {
    if (connected) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    fetchRooms();
    pollRef.current = setInterval(fetchRooms, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [connected, fetchRooms]);

  const handleJoin = useCallback(
    (nameOverride?: string) => {
      const room = nameOverride || roomInput.trim() || "default";
      addRecentRoom(room);
      onJoinRoom(room);
    },
    [roomInput, onJoinRoom]
  );

  // Build room list (memoize to avoid localStorage reads on every render)
  const roomListItems = useMemo(() => {
    if (liveRooms.length > 0) return liveRooms;
    const recent = getRecentRooms();
    if (recent.length > 0) return recent.map((name) => ({ name, count: 0 }));
    return SUGGESTED_ROOMS.map((name) => ({ name, count: 0 }));
  }, [liveRooms]);

  return (
    <div className="flex flex-col bg-[var(--mantle)] border-r border-[var(--surface0)] overflow-y-auto">
      {/* Username */}
      <div className="p-3 px-3.5 border-b border-[var(--surface0)]">
        <div className="text-[0.6rem] text-[var(--overlay)] uppercase tracking-widest font-semibold mb-1.5">
          You
        </div>
        <input
          type="text"
          spellCheck={false}
          placeholder="your name"
          className="w-full px-2.5 py-1.5 bg-[var(--crust)] border border-[var(--surface0)] rounded-[7px] text-[var(--text)] font-mono text-[0.78rem] outline-none focus:border-[var(--surface1)]"
          value={username}
          onChange={(e) => onUsernameChange(e.target.value)}
        />
      </div>

      {/* Room */}
      <div className="p-3 px-3.5 border-b border-[var(--surface0)]">
        <div className="text-[0.6rem] text-[var(--overlay)] uppercase tracking-widest font-semibold mb-1.5">
          Room
        </div>

        {!connected ? (
          /* Lobby */
          <div>
            <div className="flex rounded-lg overflow-hidden border border-[var(--surface0)] bg-[var(--crust)] mb-1.5 focus-within:border-[var(--surface1)] transition-colors">
              <input
                type="text"
                spellCheck={false}
                placeholder="room name"
                autoComplete="off"
                className="flex-1 min-w-0 px-2.5 py-2 bg-transparent border-none text-[var(--text)] font-mono text-[0.8rem] outline-none"
                value={roomInput}
                onChange={(e) => setRoomInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleJoin();
                }}
              />
              <button
                className="w-10 border-none bg-[var(--surface0)] text-[var(--overlay)] cursor-pointer flex items-center justify-center transition-all duration-150 hover:bg-[var(--accent)] hover:text-[var(--crust)] active:scale-92"
                onClick={() => handleJoin()}
                title="Join"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
              </button>
            </div>

            <button
              className="inline-flex items-center gap-1.5 px-2 py-0.5 mb-1.5 bg-transparent border border-transparent text-[var(--overlay)] text-[0.62rem] font-sans cursor-pointer rounded transition-all duration-150 hover:text-[var(--accent)] hover:border-[var(--surface0)]"
              onClick={() => setRoomInput(randomRoomName())}
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M16 3h5v5" />
                <path d="M4 20 21 3" />
                <path d="M21 16v5h-5" />
                <path d="M15 15l6 6" />
                <path d="M4 4l5 5" />
              </svg>
              random
            </button>

            <div className="flex flex-col gap-px mt-0.5">
              {roomListItems.map((r) => (
                <div
                  key={r.name}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-all duration-150 border border-transparent hover:bg-[var(--surface0)] hover:border-[var(--surface0)] group"
                  onClick={() => handleJoin(r.name)}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors duration-150 ${r.count ? "bg-[var(--green)]" : "bg-[var(--surface2)] group-hover:bg-[var(--accent)]"}`}
                  />
                  <span className="font-mono text-[0.72rem] text-[var(--subtext)] transition-colors group-hover:text-[var(--text)]">
                    {r.name}
                  </span>
                  {r.count > 0 && (
                    <span className="ml-auto text-[0.55rem] px-1.5 bg-[var(--surface0)] rounded-lg text-[var(--overlay)] font-mono">
                      {r.count}
                    </span>
                  )}
                  <span className="ml-auto text-[0.55rem] px-2 rounded-md text-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] opacity-0 group-hover:opacity-100 transition-opacity font-medium">
                    Join
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* Connected */
          <div className="animate-in fade-in slide-in-from-top-1 duration-200">
            <div
              className={`flex items-center gap-3 p-3.5 rounded-[10px] border transition-all duration-300 ${
                connectedUsers.length === 0
                  ? "bg-[color-mix(in_srgb,var(--yellow)_4%,var(--crust))] border-[color-mix(in_srgb,var(--yellow)_20%,var(--surface0))]"
                  : "bg-[color-mix(in_srgb,var(--accent)_5%,var(--crust))] border-[color-mix(in_srgb,var(--accent)_12%,var(--surface0))]"
              }`}
            >
              {/* Beacon */}
              <div className="relative w-8 h-8 flex items-center justify-center flex-shrink-0">
                <div className="absolute inset-0 rounded-full border-[1.5px] border-[var(--accent)] opacity-25 animate-[beacon_2.4s_ease-in-out_infinite]" />
                <div className="w-2.5 h-2.5 rounded-full bg-[var(--accent)] shadow-[0_0_10px_color-mix(in_srgb,var(--accent)_40%,transparent)] relative z-10" />
              </div>
              <div>
                <div className="font-mono text-[0.88rem] font-semibold text-[var(--text)] leading-none">
                  {connectedRoom}
                </div>
                <div className="text-[0.65rem] text-[var(--overlay)] mt-0.5">
                  {connectedUsers.length + 1} connected
                </div>
              </div>
            </div>

            {connectedUsers.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {connectedUsers.map((name) => (
                  <span
                    key={name}
                    className="font-mono text-[0.6rem] px-2 py-0.5 bg-[var(--surface0)] rounded-xl text-[var(--subtext)]"
                  >
                    {name}
                  </span>
                ))}
              </div>
            )}

            <button
              className="w-full mt-2 py-1.5 px-3.5 rounded-[7px] border border-[color-mix(in_srgb,var(--red)_12%,var(--surface0))] bg-[color-mix(in_srgb,var(--red)_5%,var(--surface0))] text-[var(--subtext)] font-sans text-[0.72rem] font-medium cursor-pointer transition-all duration-150 hover:bg-[color-mix(in_srgb,var(--red)_14%,var(--surface0))] hover:border-[color-mix(in_srgb,var(--red)_25%,var(--surface0))] hover:text-[var(--red)]"
              onClick={onLeaveRoom}
            >
              Leave
            </button>
          </div>
        )}
      </div>

      {/* Codec */}
      <div className="p-3 px-3.5 border-b border-[var(--surface0)]">
        <div className="text-[0.6rem] text-[var(--overlay)] uppercase tracking-widest font-semibold mb-1.5">
          Codec
        </div>
        <CodecStatus state={codec.state} text={codec.statusText} />
        <Button
          className="w-full mt-1 text-[0.75rem]"
          variant="secondary"
          size="sm"
          onClick={codec.loadModels}
          disabled={codec.modelsLoaded || codec.state === "loading"}
        >
          {codec.modelsLoaded ? "Loaded (50hz)" : "Load Models"}
        </Button>
        <Button
          className="w-full mt-1 text-[0.65rem] opacity-40 hover:opacity-70"
          variant="ghost"
          size="sm"
          onClick={codec.clearModelCache}
        >
          Clear Cache
        </Button>
        <ModelProgress value={codec.progress} />
      </div>

      {/* QR Link */}
      <div className="mt-auto p-2 px-3.5 border-t-0">
        <a
          href="/qr"
          className="flex items-center gap-2 text-[var(--overlay)] text-[0.75rem] no-underline transition-colors hover:text-[var(--accent)] py-1"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="flex-shrink-0"
          >
            <rect x="2" y="2" width="8" height="8" rx="1" />
            <rect x="14" y="2" width="8" height="8" rx="1" />
            <rect x="2" y="14" width="8" height="8" rx="1" />
            <rect x="14" y="14" width="4" height="4" />
            <line x1="22" y1="14" x2="22" y2="18" />
            <line x1="18" y1="22" x2="22" y2="22" />
          </svg>
          Voice QR
        </a>
      </div>
    </div>
  );
}
