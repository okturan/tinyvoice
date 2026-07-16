import { DurableObject } from "cloudflare:workers";

const ALARM_INTERVAL_MS = 5 * 60 * 1000;
const STALE_THRESHOLD_MS = 10 * 60 * 1000;
const MAX_ROOM_CODE_POINTS = 64;
const MAX_DISPLAY_NAME_CODE_POINTS = 32;
const MAX_RELAY_PAYLOAD_BYTES = 64 * 1024;
const MAX_ROOM_CONNECTIONS = 64;
const MAX_CONTROL_MESSAGE_CODE_UNITS = 1024;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

interface StoredRoom {
  count: number;
  lastUpdated: number;
}

type StoredRooms = Record<string, StoredRoom>;

interface SessionAttachment {
  name: string;
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
    Number.isFinite(candidate.lastUpdated)
  );
}

function isCodecPacket(payload: ArrayBuffer): boolean {
  const bytes = new Uint8Array(payload);
  if (bytes.byteLength < 2) return false;
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

  private async setRoomCount(room: string, count: number): Promise<void> {
    const rooms = await this.getRooms();
    if (count > 0) {
      rooms[room] = { count, lastUpdated: Date.now() };
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
        rooms[room] = { count, lastUpdated: now } satisfies StoredRoom;
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
        await this.setRoomCount(room, count as number);
        return Response.json({ ok: true });
      }

      if (request.method === "GET" && url.pathname === "/list") {
        const rooms = await this.getRooms();
        const list = Object.entries(rooms)
          .map(([name, data]) => ({ name, count: data.count }))
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
  private openSockets(exclude?: WebSocket): WebSocket[] {
    return this.ctx
      .getWebSockets()
      .filter((socket) => socket !== exclude && socket.readyState === WebSocket.OPEN);
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
      const response = await this.env.LOBBY.getByName("main").fetch("http://internal/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room, count }),
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
        const name = normalizeDisplayName((parsed as { name?: unknown }).name);
        if (!name) return;
        socket.serializeAttachment({ name } satisfies SessionAttachment);
        this.broadcastUsers();
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
    this.broadcastPayload(socket, message);
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    this.broadcastUsers(socket);
    await this.notifyLobby(this.openSockets(socket).length);
  }

  async webSocketError(socket: WebSocket, error: unknown): Promise<void> {
    console.error(JSON.stringify({
      message: "room WebSocket error",
      room: this.ctx.id.name ?? "unknown",
      error: error instanceof Error ? error.message : String(error),
    }));
    this.broadcastUsers(socket);
    await this.notifyLobby(this.openSockets(socket).length);
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
