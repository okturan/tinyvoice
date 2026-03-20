import { RoomProvider } from "@/contexts/RoomContext";
import { RoomLobby } from "@/components/room/RoomLobby";
import { RoomActiveCard } from "@/components/room/RoomActiveCard";
import { UsernameInput } from "@/components/shared/UsernameInput";
import { useRoom } from "@/contexts/RoomContext";

function RoomPanel() {
  const { currentRoom } = useRoom();
  return currentRoom ? <RoomActiveCard /> : <RoomLobby />;
}

export default function App() {
  return (
    <RoomProvider>
      <div className="flex min-h-screen flex-col gap-4 p-4 dark">
        <div className="mx-auto flex w-full max-w-md flex-col gap-4">
          <h1 className="text-xl font-bold">TinyVoice</h1>
          <UsernameInput />
          <RoomPanel />
        </div>
      </div>
    </RoomProvider>
  );
}
