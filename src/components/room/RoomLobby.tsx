import { useRoom } from "@/contexts/RoomContext";
import { RoomInput } from "./RoomInput";
import { RoomList } from "./RoomList";

export function RoomLobby() {
  const { activeRooms, recentRooms, joinRoom } = useRoom();

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        Room
      </h2>
      <RoomInput onJoin={joinRoom} />
      <RoomList
        activeRooms={activeRooms}
        recentRooms={recentRooms}
        onJoin={joinRoom}
      />
    </div>
  );
}
