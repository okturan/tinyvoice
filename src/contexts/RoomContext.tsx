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
import { useCodecContext } from "@/contexts/CodecContext";
import {
  normalizeDisplayName,
  normalizeRoomName,
  type LobbyRoom,
  type RelayErrorMessage,
  type RelayQuality,
} from "@/lib/ws/relay";

type PacketHandler = (data: ArrayBuffer, sender: string | null) => void;
type RelayErrorHandler = (message: RelayErrorMessage) => void;

interface RoomContextValue {
  currentRoom: string | null;
  users: string[];
  userCount: number;
  isConnected: boolean;
  /** The quality this room is locked to (set by its first participant) */
  roomQuality: RelayQuality | null;
  activeRooms: LobbyRoom[];
  recentRooms: string[];
  joinRoom: (name: string, quality?: RelayQuality) => boolean;
  leaveRoom: () => void;
  sendPacket: (data: ArrayBuffer) => void;
  onPacketReceived: (handler: PacketHandler) => () => void;
  onRelayError: (handler: RelayErrorHandler) => () => void;
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
  return normalizeDisplayName(localStorage.getItem("fc-username")) ?? "";
}

export function RoomProvider({ children }: { children: ReactNode }) {
  const [currentRoom, setCurrentRoom] = useState<string | null>(null);
  const [username, setUsernameState] = useState(loadUsername);
  const packetHandlers = useRef(new Set<PacketHandler>());
  const errorHandlers = useRef(new Set<RelayErrorHandler>());
  const codec = useCodecContext();

  const { activeRooms, recentRooms, addRecentRoom, startPolling, stopPolling } =
    useRooms();

  const { isConnected, connect, disconnect, send, updateName, users, userCount, roomQuality } =
    useWebSocket({
      onBinaryMessage: (data, sender) => {
        for (const handler of packetHandlers.current) {
          handler(data, sender);
        }
      },
      onRelayError: (message) => {
        for (const handler of errorHandlers.current) {
          handler(message);
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

  const setUsername = useCallback((name: string) => {
    const normalized = normalizeDisplayName(name) ?? "";
    setUsernameState(normalized);
    localStorage.setItem("fc-username", normalized);
    updateName(normalized || "anon");
  }, [updateName]);

  const joinRoom = useCallback(
    (name: string, quality?: RelayQuality) => {
      const room = normalizeRoomName(name);
      if (!room) return false;
      // An explicit quality (default room, or the new-room picker) wins;
      // otherwise announce the user's active quality.
      connect(room, username || "anon", quality ?? codec.activeQuality);
      return true;
    },
    [connect, username, codec.activeQuality],
  );

  const onPacketReceived = useCallback(
    (handler: PacketHandler) => {
      packetHandlers.current.add(handler);
      return () => {
        packetHandlers.current.delete(handler);
      };
    },
    [],
  );

  const onRelayError = useCallback(
    (handler: RelayErrorHandler) => {
      errorHandlers.current.add(handler);
      return () => {
        errorHandlers.current.delete(handler);
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
      roomQuality,
      activeRooms,
      recentRooms,
      joinRoom,
      leaveRoom: disconnect,
      sendPacket: send,
      onPacketReceived,
      onRelayError,
      username,
      setUsername,
    }),
    [
      currentRoom,
      users,
      userCount,
      isConnected,
      roomQuality,
      activeRooms,
      recentRooms,
      joinRoom,
      disconnect,
      send,
      onPacketReceived,
      onRelayError,
      username,
      setUsername,
    ],
  );

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}
