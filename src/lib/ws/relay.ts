/** WebSocket relay URL (auto-detects local dev) */
export const RELAY_WS =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "ws://localhost:8787/ws/"
    : "wss://tinyvoice-relay.okan.workers.dev/ws/";

/** HTTP endpoint for lobby room list */
export const RELAY_HTTP =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8787"
    : "https://tinyvoice-relay.okan.workers.dev";

export const MAX_ROOM_CODE_POINTS = 64;
export const MAX_DISPLAY_NAME_CODE_POINTS = 32;
export const MAX_RECONNECT_ATTEMPTS = 5;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const RETRYABLE_CLOSE_CODES = new Set([1001, 1006, 1011, 1012, 1013]);

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
  if (typeof data !== "object" || data === null) return false;
  const candidate = data as Partial<UsersMessage>;
  return candidate.type === "users" &&
    Number.isInteger(candidate.count) &&
    candidate.count! >= 0 &&
    Array.isArray(candidate.names) &&
    candidate.names.length === candidate.count &&
    candidate.names.every(isDisplayName);
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

export function parseLobbyRooms(data: unknown): LobbyRoom[] | null {
  if (!Array.isArray(data)) return null;
  const rooms: LobbyRoom[] = [];
  for (const value of data) {
    if (typeof value !== "object" || value === null) return null;
    const candidate = value as Partial<LobbyRoom>;
    if (
      typeof candidate.name !== "string" ||
      normalizeRoomName(candidate.name) !== candidate.name ||
      !Number.isInteger(candidate.count) ||
      candidate.count! < 0 ||
      candidate.count! > 64
    ) {
      return null;
    }
    rooms.push({ name: candidate.name, count: candidate.count as number });
  }
  return rooms;
}

function isDisplayName(value: unknown): value is string {
  return typeof value === "string" && normalizeDisplayName(value) === value;
}

export function normalizeRoomName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const room = input.normalize("NFC").trim();
  if (
    room.length === 0 ||
    room === "." ||
    room === ".." ||
    Array.from(room).length > MAX_ROOM_CODE_POINTS ||
    CONTROL_CHARACTERS.test(room) ||
    /[/?#]/u.test(room)
  ) {
    return null;
  }
  return room;
}

export function normalizeDisplayName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const name = input.normalize("NFC").trim();
  if (name.length === 0 || CONTROL_CHARACTERS.test(name)) return null;
  return Array.from(name).slice(0, MAX_DISPLAY_NAME_CODE_POINTS).join("");
}

export function shouldReconnect(code: number, attempts: number): boolean {
  return attempts < MAX_RECONNECT_ATTEMPTS && RETRYABLE_CLOSE_CODES.has(code);
}
