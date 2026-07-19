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

/** Quality identifiers shared with the relay (match the Quality enum values) */
export type RelayQuality = "50hz" | "25hz" | "12_5hz";
const VALID_QUALITIES = new Set<string>(["50hz", "25hz", "12_5hz"]);

export function normalizeRelayQuality(input: unknown): RelayQuality | null {
  return typeof input === "string" && VALID_QUALITIES.has(input)
    ? (input as RelayQuality)
    : null;
}

/** Client sends this on connect to announce its username (and quality, to lock empty rooms) */
export interface HelloMessage {
  type: "hello";
  name: string;
  quality?: RelayQuality;
}

/** Server broadcasts this when the user list changes */
export interface UsersMessage {
  type: "users";
  count: number;
  names: string[];
}

/** Server sends this on join and whenever the room's locked quality changes */
export interface RoomInfoMessage {
  type: "room";
  quality: RelayQuality | null;
}

/** Server sends this to a sender whose packet was rejected */
export interface RelayErrorMessage {
  type: "error";
  code: string;
  quality?: RelayQuality | null;
}

export type ServerMessage = UsersMessage | RoomInfoMessage | RelayErrorMessage;

/** A room returned from the lobby API */
export interface LobbyRoom {
  name: string;
  count: number;
  quality: RelayQuality | null;
}

// ── Relay payload wrapping ─────────────────────────────

/**
 * Server→client packets are wrapped: [0xFE][nameLen][sender utf8][packet].
 * 0xFE is reserved on the wire — the relay rejects client packets that
 * start with it — so a leading 0xFE unambiguously means "wrapped".
 */
export const RELAY_WRAP_MARKER = 0xfe;

export function unwrapRelayPayload(data: ArrayBuffer): {
  sender: string | null;
  packet: ArrayBuffer;
} {
  const bytes = new Uint8Array(data);
  if (bytes.byteLength >= 2 && bytes[0] === RELAY_WRAP_MARKER) {
    const nameLength = bytes[1];
    if (bytes.byteLength >= 2 + nameLength) {
      let sender: string | null = null;
      try {
        sender = new TextDecoder().decode(bytes.subarray(2, 2 + nameLength)) || null;
      } catch {
        sender = null;
      }
      return { sender, packet: data.slice(2 + nameLength) };
    }
  }
  // Unwrapped (older worker) — treat the whole payload as the packet.
  return { sender: null, packet: data };
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

export function isRoomInfoMessage(data: unknown): data is RoomInfoMessage {
  if (typeof data !== "object" || data === null) return false;
  const candidate = data as Partial<RoomInfoMessage>;
  return candidate.type === "room" &&
    (candidate.quality === null || normalizeRelayQuality(candidate.quality) !== null);
}

export function isRelayErrorMessage(data: unknown): data is RelayErrorMessage {
  if (typeof data !== "object" || data === null) return false;
  const candidate = data as Partial<RelayErrorMessage>;
  return candidate.type === "error" && typeof candidate.code === "string";
}

export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const msg: unknown = JSON.parse(raw);
    if (isUsersMessage(msg)) return msg;
    if (isRoomInfoMessage(msg)) return msg;
    if (isRelayErrorMessage(msg)) return msg;
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
    rooms.push({
      name: candidate.name,
      count: candidate.count as number,
      quality: normalizeRelayQuality(candidate.quality),
    });
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
