import { useCallback, useRef, useState } from "react";
import {
  RELAY_WS,
  parseServerMessage,
  type HelloMessage,
} from "@/lib/ws/relay";

const MAX_RECONNECT_DELAY = 16_000;
const INITIAL_RECONNECT_DELAY = 1_000;

export interface UseWebSocketReturn {
  isConnected: boolean;
  connect: (room: string, username: string) => void;
  disconnect: () => void;
  send: (data: ArrayBuffer) => void;
  users: string[];
  userCount: number;
}

export function useWebSocket(callbacks: {
  onBinaryMessage?: (data: ArrayBuffer) => void;
  onConnected?: (room: string) => void;
  onDisconnected?: () => void;
}): UseWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [users, setUsers] = useState<string[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(INITIAL_RECONNECT_DELAY);
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

  const connect = useCallback(
    (room: string, username: string) => {
      cleanup();
      intentionalClose.current = false;
      currentRoom.current = room;
      currentUsername.current = username;

      const ws = new WebSocket(RELAY_WS + encodeURIComponent(room));
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        reconnectDelay.current = INITIAL_RECONNECT_DELAY;
        const hello: HelloMessage = { type: "hello", name: username };
        ws.send(JSON.stringify(hello));
        callbacksRef.current.onConnected?.(room);
      };

      ws.onmessage = (e: MessageEvent) => {
        if (typeof e.data === "string") {
          const msg = parseServerMessage(e.data);
          if (msg?.type === "users") {
            setUsers(msg.names);
          }
          return;
        }
        if (e.data instanceof ArrayBuffer) {
          callbacksRef.current.onBinaryMessage?.(e.data);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        setUsers([]);

        if (
          !intentionalClose.current &&
          currentRoom.current &&
          currentUsername.current
        ) {
          const delay = reconnectDelay.current;
          reconnectDelay.current = Math.min(delay * 2, MAX_RECONNECT_DELAY);
          const savedRoom = currentRoom.current;
          const savedUsername = currentUsername.current;
          reconnectTimer.current = setTimeout(() => {
            connect(savedRoom, savedUsername);
          }, delay);
        } else {
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
    cleanup();
    setIsConnected(false);
    setUsers([]);
    callbacksRef.current.onDisconnected?.();
  }, [cleanup]);

  const send = useCallback((data: ArrayBuffer) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }, []);

  return {
    isConnected,
    connect,
    disconnect,
    send,
    users,
    userCount: users.length,
  };
}
