/** WebSocket relay URL (auto-detects local dev) */
export const RELAY_WS =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "ws://localhost:8787/ws/"
    : "wss://focalcodec-relay.okan.workers.dev/ws/";

/** HTTP endpoint for lobby room list */
export const RELAY_HTTP =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8787"
    : "https://focalcodec-relay.okan.workers.dev";

// ── Message types ──────────────────────────────────────

/** Client sends this on connect to announce its username */
export interface HelloMessage {
  type: "hello";
  name: string;
}

/** Server broadcasts this when the user list changes */
export interface UsersMessage {
  type: "users";
  count: number;
  names: string[];
}

export type ServerMessage = UsersMessage;

/** A room returned from the lobby API */
export interface LobbyRoom {
  name: string;
  count: number;
}

// ── Helpers ────────────────────────────────────────────

export function isUsersMessage(data: unknown): data is UsersMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    (data as { type: string }).type === "users"
  );
}

export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const msg: unknown = JSON.parse(raw);
    if (isUsersMessage(msg)) return msg;
    return null;
  } catch {
    return null;
  }
}
