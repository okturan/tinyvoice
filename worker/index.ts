import { DurableObject } from "cloudflare:workers";

const ALARM_INTERVAL_MS = 5 * 60 * 1000;
const STALE_THRESHOLD_MS = 10 * 60 * 1000;
const MAX_ROOM_CODE_POINTS = 64;
const MAX_DISPLAY_NAME_CODE_POINTS = 32;
const MAX_RELAY_PAYLOAD_BYTES = 64 * 1024;
const MAX_ROOM_CONNECTIONS = 64;
const MAX_CONTROL_MESSAGE_CODE_UNITS = 1024;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

type RoomQuality = "50hz" | "25hz" | "12_5hz";

const VALID_QUALITIES = new Set<string>(["50hz", "25hz", "12_5hz"]);
const QUALITY_BY_MAGIC: Record<number, RoomQuality> = { 1: "50hz", 2: "25hz", 3: "12_5hz" };
/** Server→client relayed packets are wrapped: [0xFE][nameLen][name utf8][packet] */
const RELAY_WRAP_MARKER = 0xfe;

interface StoredRoom {
  count: number;
  lastUpdated: number;
  quality?: RoomQuality;
}

type StoredRooms = Record<string, StoredRoom>;

interface SessionAttachment {
  name: string;
}

function normalizeQuality(input: unknown): RoomQuality | null {
  return typeof input === "string" && VALID_QUALITIES.has(input)
    ? (input as RoomQuality)
    : null;
}

/** The quality a packet claims via its magic byte, or null for legacy headerless packets. */
function packetQuality(payload: ArrayBuffer): RoomQuality | null {
  const bytes = new Uint8Array(payload);
  if (bytes.byteLength >= 3 && bytes.byteLength % 2 === 1) {
    const magic = bytes[0];
    return magic === undefined ? null : QUALITY_BY_MAGIC[magic] ?? null;
  }
  return null;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function normalizeRoomName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const room = input.normalize("NFC").trim();
  if (
    room.length === 0 ||
    room === "." ||
    room === ".." ||
    codePointLength(room) > MAX_ROOM_CODE_POINTS ||
    CONTROL_CHARACTERS.test(room) ||
    /[/?#]/u.test(room)
  ) {
    return null;
  }
  return room;
}

function roomNameFromPath(pathname: string): string | null {
  if (!pathname.startsWith("/ws/")) return null;
  const encoded = pathname.slice(4);
  if (!encoded || encoded.includes("/")) return null;
  try {
    return normalizeRoomName(decodeURIComponent(encoded));
  } catch {
    return null;
  }
}

function normalizeDisplayName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const name = input.normalize("NFC").trim();
  if (name.length === 0 || CONTROL_CHARACTERS.test(name)) return null;
  return Array.from(name).slice(0, MAX_DISPLAY_NAME_CODE_POINTS).join("");
}

function isStoredRoom(value: unknown): value is StoredRoom {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<StoredRoom>;
  return (
    Number.isInteger(candidate.count) &&
    candidate.count! >= 0 &&
    candidate.count! <= MAX_ROOM_CONNECTIONS &&
    typeof candidate.lastUpdated === "number" &&
    Number.isFinite(candidate.lastUpdated) &&
    (candidate.quality === undefined || normalizeQuality(candidate.quality) !== null)
  );
}

function isCodecPacket(payload: ArrayBuffer): boolean {
  const bytes = new Uint8Array(payload);
  if (bytes.byteLength < 2) return false;
  // 0xFE is reserved for the server→client sender wrap; refusing it at
  // ingress keeps the wrap marker unambiguous on the wire. Real token
  // streams never start with it (tokens are far below 0xFE00).
  if (bytes[0] === RELAY_WRAP_MARKER) return false;
  if (bytes.byteLength % 2 === 0) return true;
  return bytes.byteLength >= 3 && bytes[0] !== undefined && bytes[0] >= 1 && bytes[0] <= 3;
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };
}

function errorResponse(error: string, status: number, headers?: HeadersInit): Response {
  return Response.json({ error }, { status, headers });
}

export class Lobby extends DurableObject<Env> {
  private async getRooms(): Promise<StoredRooms> {
    const stored = (await this.ctx.storage.get<unknown>("rooms")) ?? {};
    if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
      await this.ctx.storage.put("rooms", {});
      return {};
    }

    const rooms: StoredRooms = {};
    let changed = false;
    for (const [rawName, value] of Object.entries(stored)) {
      const room = normalizeRoomName(rawName);
      if (!room) {
        changed = true;
        continue;
      }
      if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
        rooms[room] = { count: Math.min(value, MAX_ROOM_CONNECTIONS), lastUpdated: 0 };
        changed = true;
      } else if (isStoredRoom(value)) {
        rooms[room] = value;
        if (room !== rawName) changed = true;
      } else {
        changed = true;
      }
    }

    if (changed) await this.ctx.storage.put("rooms", rooms);
    return rooms;
  }

  private async ensureAlarm(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    }
  }

  private async setRoomCount(
    room: string,
    count: number,
    quality?: RoomQuality | null,
  ): Promise<void> {
    const rooms = await this.getRooms();
    if (count > 0) {
      // `undefined` quality preserves whatever is stored; null clears it.
      const resolved = quality === undefined ? rooms[room]?.quality : quality ?? undefined;
      rooms[room] = { count, lastUpdated: Date.now(), ...(resolved ? { quality: resolved } : {}) };
    } else {
      delete rooms[room];
    }
    await this.ctx.storage.put("rooms", rooms);
    if (Object.keys(rooms).length > 0) {
      await this.ensureAlarm();
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }

  private async actualRoomCount(room: string): Promise<number | null> {
    try {
      const response = await this.env.ROOMS.getByName(room).fetch("http://internal/count");
      if (!response.ok) throw new Error(`Room returned HTTP ${response.status}`);
      const body: unknown = await response.json();
      const count = typeof body === "object" && body !== null
        ? (body as { count?: unknown }).count
        : undefined;
      if (!Number.isInteger(count) || (count as number) < 0 || (count as number) > MAX_ROOM_CONNECTIONS) {
        throw new Error("Room returned an invalid count");
      }
      return count as number;
    } catch (error) {
      console.error(JSON.stringify({
        message: "room reconciliation failed",
        room,
        error: error instanceof Error ? error.message : String(error),
      }));
      return null;
    }
  }

  private async applyReconciliation(
    room: string,
    count: number,
    now: number,
    observedLastUpdated: number,
  ): Promise<void> {
    await this.ctx.storage.transaction(async (transaction) => {
      const stored = (await transaction.get<unknown>("rooms")) ?? {};
      if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return;
      const rooms = { ...stored } as Record<string, unknown>;
      const current = rooms[room];
      if (!isStoredRoom(current) || current.lastUpdated !== observedLastUpdated) return;
      if (count > 0) {
        rooms[room] = {
          count,
          lastUpdated: now,
          ...(current.quality ? { quality: current.quality } : {}),
        } satisfies StoredRoom;
      } else {
        delete rooms[room];
      }
      await transaction.put("rooms", rooms);
    });
  }

  async alarm(): Promise<void> {
    let shouldReschedule = true;
    try {
      const rooms = await this.getRooms();
      const now = Date.now();
      for (const [name, data] of Object.entries(rooms)) {
        if (now - data.lastUpdated > STALE_THRESHOLD_MS) {
          const count = await this.actualRoomCount(name);
          if (count !== null) {
            await this.applyReconciliation(name, count, now, data.lastUpdated);
          }
        }
      }
      shouldReschedule = Object.keys(await this.getRooms()).length > 0;
    } finally {
      if (shouldReschedule) {
        await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
      } else {
        await this.ctx.storage.deleteAlarm();
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && (url.pathname === "/update" || url.pathname === "/reconcile")) {
        const body: unknown = await request.json();
        if (typeof body !== "object" || body === null) {
          return errorResponse("invalid JSON payload", 400);
        }
        const candidate = body as Record<string, unknown>;
        const room = normalizeRoomName(candidate.room);
        const countKey = url.pathname === "/update" ? "count" : "actualCount";
        const count = candidate[countKey];
        if (
          !room ||
          !Number.isInteger(count) ||
          (count as number) < 0 ||
          (count as number) > MAX_ROOM_CONNECTIONS
        ) {
          return errorResponse(`invalid payload: need { room, ${countKey}: non-negative integer }`, 400);
        }
        // Reconciliation doesn't carry quality; preserve what's stored.
        const quality = "quality" in candidate && url.pathname === "/update"
          ? normalizeQuality(candidate.quality)
          : undefined;
        await this.setRoomCount(room, count as number, quality);
        return Response.json({ ok: true });
      }

      if (request.method === "GET" && url.pathname === "/list") {
        const rooms = await this.getRooms();
        const list = Object.entries(rooms)
          .map(([name, data]) => ({ name, count: data.count, quality: data.quality ?? null }))
          .sort((left, right) => left.name.localeCompare(right.name));
        return Response.json(list);
      }

      return errorResponse("not found", 404);
    } catch (error) {
      console.error(JSON.stringify({
        message: "lobby request failed",
        error: error instanceof Error ? error.message : String(error),
        path: url.pathname,
      }));
      return errorResponse("internal error", 500);
    }
  }
}

export class Room extends DurableObject<Env> {
  /** Cached room quality; undefined = not yet read from storage (hibernation-safe). */
  private cachedQuality: RoomQuality | null | undefined;

  private openSockets(exclude?: WebSocket): WebSocket[] {
    return this.ctx
      .getWebSockets()
      .filter((socket) => socket !== exclude && socket.readyState === WebSocket.OPEN);
  }

  private async getQuality(): Promise<RoomQuality | null> {
    if (this.cachedQuality === undefined) {
      this.cachedQuality = normalizeQuality(await this.ctx.storage.get("quality"));
    }
    return this.cachedQuality;
  }

  private async setQuality(quality: RoomQuality | null): Promise<void> {
    const current = await this.getQuality();
    if (current === quality) return;
    this.cachedQuality = quality;
    if (quality) await this.ctx.storage.put("quality", quality);
    else await this.ctx.storage.delete("quality");
    this.broadcastRoomInfo();
    await this.notifyLobby(this.openSockets().length);
  }

  private roomInfoMessage(quality: RoomQuality | null): string {
    return JSON.stringify({ type: "room", quality });
  }

  private broadcastRoomInfo(): void {
    const message = this.roomInfoMessage(this.cachedQuality ?? null);
    for (const socket of this.openSockets()) {
      try {
        socket.send(message);
      } catch {
        // The close/error handler reconciles the lobby count.
      }
    }
  }

  /** Relayed packets carry the sender's name so clients can attribute messages. */
  private wrapPayload(sender: WebSocket, payload: ArrayBuffer): ArrayBuffer {
    const nameBytes = new TextEncoder().encode(this.attachment(sender).name);
    const out = new Uint8Array(2 + nameBytes.length + payload.byteLength);
    out[0] = RELAY_WRAP_MARKER;
    out[1] = nameBytes.length;
    out.set(nameBytes, 2);
    out.set(new Uint8Array(payload), 2 + nameBytes.length);
    return out.buffer;
  }

  private attachment(socket: WebSocket): SessionAttachment {
    const value: unknown = socket.deserializeAttachment();
    if (typeof value === "object" && value !== null) {
      const name = normalizeDisplayName((value as Partial<SessionAttachment>).name);
      if (name) return { name };
    }
    return { name: "anon" };
  }

  private broadcastUsers(exclude?: WebSocket): void {
    const sockets = this.openSockets(exclude);
    const names = sockets.map((socket) => this.attachment(socket).name);
    const message = JSON.stringify({ type: "users", count: names.length, names });
    for (const socket of sockets) {
      try {
        socket.send(message);
      } catch {
        // The close/error handler reconciles the lobby count.
      }
    }
  }

  private broadcastPayload(sender: WebSocket, payload: ArrayBuffer): void {
    for (const socket of this.openSockets()) {
      if (socket === sender) continue;
      try {
        socket.send(payload);
      } catch {
        // The close/error handler reconciles the lobby count.
      }
    }
  }

  private async notifyLobby(count: number): Promise<void> {
    const room = normalizeRoomName(this.ctx.id.name);
    if (!room) return;
    try {
      const quality = await this.getQuality();
      const response = await this.env.LOBBY.getByName("main").fetch("http://internal/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room, count, quality }),
      });
      if (!response.ok) {
        throw new Error(`Lobby returned HTTP ${response.status}`);
      }
    } catch (error) {
      console.error(JSON.stringify({
        message: "lobby update failed",
        room,
        count,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/count") {
      return Response.json({ count: this.openSockets().length });
    }

    if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return errorResponse("expected WebSocket upgrade", 426);
    }

    if (this.openSockets().length >= MAX_ROOM_CONNECTIONS) {
      return errorResponse("room is full", 503);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ name: "anon" } satisfies SessionAttachment);

    try {
      server.send(this.roomInfoMessage(await this.getQuality()));
    } catch {
      // The close/error handler reconciles the lobby count.
    }
    this.broadcastUsers();
    await this.notifyLobby(this.openSockets().length);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message === "string") {
      if (message.length > MAX_CONTROL_MESSAGE_CODE_UNITS) {
        socket.close(1009, "control message exceeds 1024 code units");
        return;
      }
      try {
        const parsed: unknown = JSON.parse(message);
        if (typeof parsed !== "object" || parsed === null || (parsed as { type?: unknown }).type !== "hello") {
          return;
        }
        const hello = parsed as { name?: unknown; quality?: unknown };
        const name = normalizeDisplayName(hello.name);
        if (!name) return;
        socket.serializeAttachment({ name } satisfies SessionAttachment);
        this.broadcastUsers();

        // First arrival with a quality locks the room to it.
        const offered = normalizeQuality(hello.quality);
        if (offered && (await this.getQuality()) === null) {
          await this.setQuality(offered);
        }
      } catch {
        // Text frames are control messages only; malformed JSON is ignored.
      }
      return;
    }

    if (message.byteLength === 0 || message.byteLength > MAX_RELAY_PAYLOAD_BYTES) {
      socket.close(1009, "relay payload exceeds 64 KiB limit");
      return;
    }
    if (!isCodecPacket(message)) {
      socket.close(1003, "invalid codec packet");
      return;
    }

    const claimed = packetQuality(message);
    let roomQuality = await this.getQuality();
    if (roomQuality === null && claimed) {
      // Fallback lock for clients that never announced a quality.
      await this.setQuality(claimed);
      roomQuality = claimed;
    }
    if (roomQuality !== null && claimed !== roomQuality) {
      try {
        socket.send(JSON.stringify({ type: "error", code: "quality-mismatch", quality: roomQuality }));
      } catch {
        // The close/error handler reconciles the lobby count.
      }
      return;
    }

    this.broadcastPayload(socket, this.wrapPayload(socket, message));
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    this.broadcastUsers(socket);
    const remaining = this.openSockets(socket).length;
    if (remaining === 0) await this.setQuality(null);
    await this.notifyLobby(remaining);
  }

  async webSocketError(socket: WebSocket, error: unknown): Promise<void> {
    console.error(JSON.stringify({
      message: "room WebSocket error",
      room: this.ctx.id.name ?? "unknown",
      error: error instanceof Error ? error.message : String(error),
    }));
    this.broadcastUsers(socket);
    const remaining = this.openSockets(socket).length;
    if (remaining === 0) await this.setQuality(null);
    await this.notifyLobby(remaining);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders();

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    if (url.pathname === "/rooms") {
      if (request.method !== "GET") return errorResponse("method not allowed", 405, cors);
      try {
        const response = await env.LOBBY.getByName("main").fetch("http://internal/list");
        if (!response.ok) throw new Error(`Lobby returned HTTP ${response.status}`);
        const headers = new Headers(response.headers);
        for (const [name, value] of Object.entries(cors)) headers.set(name, value);
        return new Response(response.body, { status: response.status, headers });
      } catch (error) {
        console.error(JSON.stringify({
          message: "room list failed",
          error: error instanceof Error ? error.message : String(error),
        }));
        return errorResponse("failed to fetch room list", 502, cors);
      }
    }

    if (url.pathname.startsWith("/ws/")) {
      const room = roomNameFromPath(url.pathname);
      if (!room) return errorResponse("invalid room identifier", 400);
      return env.ROOMS.getByName(room).fetch(request);
    }

    if (url.pathname === "/health") {
      if (request.method !== "GET") return errorResponse("method not allowed", 405, cors);
      return Response.json({ status: "ok" }, { headers: cors });
    }

    return errorResponse("not found", 404, cors);
  },
} satisfies ExportedHandler<Env>;
