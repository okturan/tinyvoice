import { useState, useMemo, type KeyboardEvent } from "react";
import { useRoom } from "@/contexts/RoomContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SUGGESTED_ROOMS } from "@/lib/constants";
import { randomRoomName } from "@/lib/names";

export function ConnectionPanel() {
  const {
    currentRoom,
    users,
    userCount,
    isConnected,
    activeRooms,
    recentRooms,
    joinRoom,
    leaveRoom,
  } = useRoom();

  const [roomInput, setRoomInput] = useState("");

  const handleJoin = (nameOverride?: string) => {
    const room = nameOverride || roomInput.trim();
    if (room) joinRoom(room);
  };

  const handleShuffle = () => {
    setRoomInput(randomRoomName());
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") handleJoin();
  };

  const roomListItems = useMemo((): { name: string; count: number }[] => {
    if (activeRooms.length > 0)
      return activeRooms.map((r) => ({ name: r.name, count: r.count }));
    if (recentRooms.length > 0)
      return recentRooms.map((name) => ({ name, count: 0 }));
    return SUGGESTED_ROOMS.map((name) => ({ name, count: 0 }));
  }, [activeRooms, recentRooms]);

  if (isConnected && currentRoom) {
    return (
      <Card className="border-[var(--surface0)] bg-[var(--mantle)] gap-0 py-0 overflow-hidden">
        <CardContent className="p-3 px-4">
          <div className="flex items-center gap-3">
            {/* Green beacon */}
            <div className="relative w-8 h-8 flex items-center justify-center flex-shrink-0">
              <div className="absolute inset-0 rounded-full border-[1.5px] border-[var(--green)] opacity-25 animate-[beacon_2.4s_ease-in-out_infinite]" />
              <div className="w-2.5 h-2.5 rounded-full bg-[var(--green)] shadow-[0_0_10px_color-mix(in_srgb,var(--green)_40%,transparent)] relative z-10" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-mono text-[0.88rem] font-semibold text-[var(--text)] leading-none truncate">
                {currentRoom}
              </div>
              <div className="text-[0.65rem] text-[var(--overlay)] mt-0.5">
                {userCount} connected
              </div>
            </div>
            <Badge
              variant="secondary"
              className="bg-[var(--surface0)] text-[var(--overlay)] text-[0.55rem] font-mono border-0"
            >
              {userCount}
            </Badge>
          </div>

          {/* User tags */}
          {users.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2.5">
              {users.map((name) => (
                <span
                  key={name}
                  className="font-mono text-[0.6rem] px-2 py-0.5 bg-[var(--surface0)] rounded-xl text-[var(--subtext)]"
                >
                  {name}
                </span>
              ))}
            </div>
          )}

          {/* Leave button */}
          <button
            className="w-full mt-3 py-1.5 px-3.5 rounded-lg border border-[color-mix(in_srgb,var(--red)_12%,var(--surface0))] bg-[color-mix(in_srgb,var(--red)_5%,var(--surface0))] text-[var(--subtext)] font-sans text-[0.72rem] font-medium cursor-pointer transition-all duration-150 hover:bg-[color-mix(in_srgb,var(--red)_14%,var(--surface0))] hover:border-[color-mix(in_srgb,var(--red)_25%,var(--surface0))] hover:text-[var(--red)]"
            onClick={leaveRoom}
          >
            Leave
          </button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-[var(--surface0)] bg-[var(--mantle)] gap-0 py-0 overflow-hidden">
      <CardContent className="p-3 px-4">
        {/* Room input */}
        <div className="flex rounded-lg overflow-hidden border border-[var(--surface0)] bg-[var(--crust)] mb-2 focus-within:border-[var(--surface1)] transition-colors">
          <input
            type="text"
            spellCheck={false}
            placeholder="room name"
            autoComplete="off"
            className="flex-1 min-w-0 px-2.5 py-2 bg-transparent border-none text-[var(--text)] font-mono text-[0.8rem] outline-none"
            value={roomInput}
            onChange={(e) => setRoomInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            className="w-10 border-none bg-[var(--surface0)] text-[var(--overlay)] cursor-pointer flex items-center justify-center transition-all duration-150 hover:bg-[var(--tv-accent)] hover:text-[var(--crust)] active:scale-92"
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
          <button
            className="w-10 border-none border-l border-l-[var(--surface0)] bg-[var(--surface0)] text-[var(--overlay)] cursor-pointer flex items-center justify-center transition-all duration-150 hover:text-[var(--tv-accent)] active:scale-92"
            onClick={handleShuffle}
            title="Random room"
          >
            <svg
              width="12"
              height="12"
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
          </button>
        </div>

        {/* Suggested rooms */}
        <div className="flex flex-wrap gap-1">
          {roomListItems.map((r) => (
            <button
              key={r.name}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer transition-all duration-150 border border-transparent hover:bg-[var(--surface0)] hover:border-[var(--surface0)] group text-left"
              onClick={() => handleJoin(r.name)}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors duration-150 ${
                  r.count
                    ? "bg-[var(--green)]"
                    : "bg-[var(--surface2)] group-hover:bg-[var(--tv-accent)]"
                }`}
              />
              <span className="font-mono text-[0.68rem] text-[var(--subtext)] transition-colors group-hover:text-[var(--text)]">
                {r.name}
              </span>
              {r.count > 0 && (
                <span className="text-[0.5rem] px-1.5 bg-[var(--surface0)] rounded-lg text-[var(--overlay)] font-mono">
                  {r.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
