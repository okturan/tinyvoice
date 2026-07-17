import { useCallback, useRef, useState } from "react";
import {
  RELAY_WS,
  parseServerMessage,
  shouldReconnect,
  unwrapRelayPayload,
  type HelloMessage,
  type RelayErrorMessage,
  type RelayQuality,
} from "@/lib/ws/relay";

const MAX_RECONNECT_DELAY = 16_000;
const INITIAL_RECONNECT_DELAY = 1_000;

export interface UseWebSocketReturn {
  isConnected: boolean;
  connect: (room: string, username: string, quality?: RelayQuality | null) => void;
  updateName: (username: string) => void;
  disconnect: () => void;
  send: (data: ArrayBuffer) => void;
  users: string[];
  userCount: number;
  /** The quality the room is locked to, or null while unlocked/unknown */
  roomQuality: RelayQuality | null;
}

export function useWebSocket(callbacks: {
  onBinaryMessage?: (data: ArrayBuffer, sender: string | null) => void;
  onRelayError?: (message: RelayErrorMessage) => void;
  onConnected?: (room: string) => void;
  onDisconnected?: () => void;
}): UseWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [users, setUsers] = useState<string[]>([]);
  const [roomQuality, setRoomQuality] = useState<RelayQuality | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(INITIAL_RECONNECT_DELAY);
  const reconnectAttempts = useRef(0);
  const intentionalClose = useRef(false);
  const currentRoom = useRef<string | null>(null);
  const currentUsername = useRef<string>("");
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const cleanup = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    const ws = wsRef.current;
    if (ws) {
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    }
  }, []);

  const currentQuality = useRef<RelayQuality | null>(null);

  const connect = useCallback(
    (room: string, username: string, quality: RelayQuality | null = null, isRetry = false) => {
      cleanup();
      if (!isRetry) reconnectAttempts.current = 0;
      intentionalClose.current = false;
      currentRoom.current = room;
      currentUsername.current = username;
      currentQuality.current = quality;

      const ws = new WebSocket(RELAY_WS + encodeURIComponent(room));
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        reconnectDelay.current = INITIAL_RECONNECT_DELAY;
        reconnectAttempts.current = 0;
        const hello: HelloMessage = {
          type: "hello",
          name: username,
          ...(quality ? { quality } : {}),
        };
        ws.send(JSON.stringify(hello));
        callbacksRef.current.onConnected?.(room);
      };

      ws.onmessage = (e: MessageEvent) => {
        if (typeof e.data === "string") {
          const msg = parseServerMessage(e.data);
          if (msg?.type === "users") {
            setUsers(msg.names);
          } else if (msg?.type === "room") {
            setRoomQuality(msg.quality);
          } else if (msg?.type === "error") {
            callbacksRef.current.onRelayError?.(msg);
          }
          return;
        }
        if (e.data instanceof ArrayBuffer) {
          const { sender, packet } = unwrapRelayPayload(e.data);
          callbacksRef.current.onBinaryMessage?.(packet, sender);
        }
      };

      ws.onclose = (event) => {
        if (wsRef.current === ws) wsRef.current = null;
        setIsConnected(false);
        setUsers([]);
        setRoomQuality(null);

        if (
          !intentionalClose.current &&
          currentRoom.current &&
          currentUsername.current &&
          shouldReconnect(event.code, reconnectAttempts.current)
        ) {
          reconnectAttempts.current += 1;
          const delay = reconnectDelay.current;
          reconnectDelay.current = Math.min(delay * 2, MAX_RECONNECT_DELAY);
          const savedRoom = currentRoom.current;
          const savedUsername = currentUsername.current;
          const savedQuality = currentQuality.current;
          reconnectTimer.current = setTimeout(() => {
            reconnectTimer.current = null;
            connect(savedRoom, savedUsername, savedQuality, true);
          }, delay);
        } else {
          currentRoom.current = null;
          currentUsername.current = "";
          callbacksRef.current.onDisconnected?.();
        }
      };

      ws.onerror = () => {
        // onclose will fire after this
      };
    },
    [cleanup],
  );

  const disconnect = useCallback(() => {
    intentionalClose.current = true;
    currentRoom.current = null;
    currentUsername.current = "";
    currentQuality.current = null;
    cleanup();
    setIsConnected(false);
    setUsers([]);
    setRoomQuality(null);
    callbacksRef.current.onDisconnected?.();
  }, [cleanup]);

  const updateName = useCallback((username: string) => {
    currentUsername.current = username;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const hello: HelloMessage = {
        type: "hello",
        name: username,
        ...(currentQuality.current ? { quality: currentQuality.current } : {}),
      };
      ws.send(JSON.stringify(hello));
    }
  }, []);

  const send = useCallback((data: ArrayBuffer) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }, []);

  return {
    isConnected,
    connect,
    updateName,
    disconnect,
    send,
    users,
    userCount: users.length,
    roomQuality,
  };
}
