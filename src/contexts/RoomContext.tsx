import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useRooms } from "@/hooks/useRooms";

interface RoomContextValue {
  currentRoom: string | null;
  users: string[];
  userCount: number;
  isConnected: boolean;
  activeRooms: { name: string; count: number }[];
  recentRooms: string[];
  joinRoom: (name: string) => void;
  leaveRoom: () => void;
  sendPacket: (data: ArrayBuffer) => void;
  onPacketReceived: (handler: (data: ArrayBuffer) => void) => () => void;
  username: string;
  setUsername: (name: string) => void;
}

const RoomContext = createContext<RoomContextValue | null>(null);

export function useRoom(): RoomContextValue {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error("useRoom must be used within <RoomProvider>");
  return ctx;
}

function loadUsername(): string {
  return localStorage.getItem("fc-username") || "";
}

export function RoomProvider({ children }: { children: ReactNode }) {
  const [currentRoom, setCurrentRoom] = useState<string | null>(null);
  const [username, setUsernameState] = useState(loadUsername);
  const packetHandlers = useRef(new Set<(data: ArrayBuffer) => void>());

  const setUsername = useCallback((name: string) => {
    setUsernameState(name);
    localStorage.setItem("fc-username", name);
  }, []);

  const { activeRooms, recentRooms, addRecentRoom, startPolling, stopPolling } =
    useRooms();

  const { isConnected, connect, disconnect, send, users, userCount } =
    useWebSocket({
      onBinaryMessage: (data) => {
        for (const handler of packetHandlers.current) {
          handler(data);
        }
      },
      onConnected: (room) => {
        setCurrentRoom(room);
        addRecentRoom(room);
        stopPolling();
      },
      onDisconnected: () => {
        setCurrentRoom(null);
        startPolling();
      },
    });

  const joinRoom = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      connect(trimmed, username || "anon");
    },
    [connect, username],
  );

  const onPacketReceived = useCallback(
    (handler: (data: ArrayBuffer) => void) => {
      packetHandlers.current.add(handler);
      return () => {
        packetHandlers.current.delete(handler);
      };
    },
    [],
  );

  // Start polling when not in a room
  useEffect(() => {
    if (!currentRoom) {
      startPolling();
    }
    return () => {
      stopPolling();
    };
  }, [currentRoom, startPolling, stopPolling]);

  const value = useMemo<RoomContextValue>(
    () => ({
      currentRoom,
      users,
      userCount,
      isConnected,
      activeRooms,
      recentRooms,
      joinRoom,
      leaveRoom: disconnect,
      sendPacket: send,
      onPacketReceived,
      username,
      setUsername,
    }),
    [
      currentRoom,
      users,
      userCount,
      isConnected,
      activeRooms,
      recentRooms,
      joinRoom,
      disconnect,
      send,
      onPacketReceived,
      username,
      setUsername,
    ],
  );

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}
