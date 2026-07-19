import { env, exports as workerExports } from "cloudflare:workers";
import {
  evictDurableObject,
  reset,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

interface UsersPayload {
  type: "users";
  count: number;
  names: string[];
}

interface RoomPayload {
  type: "room";
  quality: string | null;
}

interface ErrorPayload {
  type: "error";
  code: string;
  quality?: string | null;
}

interface LobbyRoomPayload {
  name: string;
  count: number;
  quality: string | null;
}

async function workerFetch(path: string, init?: RequestInit): Promise<Response> {
  return workerExports.default.fetch(new Request(`https://relay.test${path}`, init));
}

/** Waits for the next control message of the given type, skipping others. */
function nextControl<T extends { type: string }>(socket: WebSocket, type: T["type"]): Promise<T> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      const parsed = JSON.parse(event.data) as { type?: string };
      if (parsed.type !== type) return;
      cleanup();
      resolve(parsed as T);
    };
    const onClose = (event: CloseEvent) => {
      cleanup();
      reject(new Error(`socket closed before "${type}" message (${event.code})`));
    };
    const cleanup = () => {
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
  });
}

const nextUsers = (socket: WebSocket) => nextControl<UsersPayload>(socket, "users");
const nextRoom = (socket: WebSocket) => nextControl<RoomPayload>(socket, "room");
const nextError = (socket: WebSocket) => nextControl<ErrorPayload>(socket, "error");

function nextBinary(socket: WebSocket): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      cleanup();
      resolve(event.data);
    };
    const onClose = (event: CloseEvent) => {
      cleanup();
      reject(new Error(`socket closed before binary message (${event.code})`));
    };
    const cleanup = () => {
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
  });
}

function nextClose(socket: WebSocket): Promise<CloseEvent> {
  return new Promise((resolve) => {
    socket.addEventListener("close", resolve, { once: true });
  });
}

/** Mirrors the relay's [0xFE][nameLen][name][packet] server→client wrap. */
function unwrap(data: ArrayBuffer): { sender: string; packet: Uint8Array } {
  const bytes = new Uint8Array(data);
  expect(bytes[0]).toBe(0xfe);
  const nameLength = bytes[1];
  const sender = new TextDecoder().decode(bytes.subarray(2, 2 + nameLength));
  return { sender, packet: bytes.subarray(2 + nameLength) };
}

async function openSocket(room: string): Promise<{
  socket: WebSocket;
  roomInfo: RoomPayload;
  initial: UsersPayload;
}> {
  const response = await workerFetch(`/ws/${encodeURIComponent(room)}`, {
    headers: { Upgrade: "websocket" },
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  expect(socket).not.toBeNull();
  socket!.binaryType = "arraybuffer";
  const roomInfo = nextRoom(socket!);
  const initial = nextUsers(socket!);
  socket!.accept();
  return { socket: socket!, roomInfo: await roomInfo, initial: await initial };
}

afterEach(async () => {
  await reset();
});

async function roomList(): Promise<LobbyRoomPayload[]> {
  const response = await workerFetch("/rooms");
  expect(response.ok).toBe(true);
  return response.json();
}

async function expectRoomList(expected: LobbyRoomPayload[]): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (JSON.stringify(await roomList()) === JSON.stringify(expected)) return;
    await scheduler.wait(1);
  }
  expect(await roomList()).toEqual(expected);
}

describe("Worker HTTP routes", () => {
  it("serves health, CORS, method, and not-found responses", async () => {
    const health = await workerFetch("/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });
    expect(health.headers.get("Access-Control-Allow-Origin")).toBe("*");

    expect((await workerFetch("/health", { method: "POST" })).status).toBe(405);
    expect((await workerFetch("/missing")).status).toBe(404);
    const options = await workerFetch("/anything", { method: "OPTIONS" });
    expect(options.status).toBe(200);
    expect(options.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
  });

  it.each(["/ws/", "/ws/a/b", "/ws/%2F", `/ws/${"a".repeat(65)}`])(
    "rejects invalid room route %s",
    async (path) => expect((await workerFetch(path)).status).toBe(400),
  );

  it("requires an actual WebSocket upgrade for a valid room", async () => {
    expect((await workerFetch("/ws/odin")).status).toBe(426);
  });
});

describe("Room WebSocket Durable Object", () => {
  it("canonicalizes room identity, validates control frames, and relays wrapped bytes", async () => {
    const first = await openSocket(" café ");
    expect(first.roomInfo).toEqual({ type: "room", quality: null });
    expect(first.initial).toEqual({ type: "users", count: 1, names: ["anon"] });

    let update = nextUsers(first.socket);
    first.socket.send(JSON.stringify({ type: "hello", name: " Ada " }));
    expect(await update).toEqual({ type: "users", count: 1, names: ["Ada"] });

    update = nextUsers(first.socket);
    const second = await openSocket("café");
    expect(second.roomInfo).toEqual({ type: "room", quality: null });
    expect([...(await update).names].sort()).toEqual(["Ada", "anon"]);
    expect([...second.initial.names].sort()).toEqual(["Ada", "anon"]);
    expect(await roomList()).toEqual([{ name: "café", count: 2, quality: null }]);

    const longName = "🙂".repeat(40);
    const firstNames = nextUsers(first.socket);
    const secondNames = nextUsers(second.socket);
    second.socket.send(JSON.stringify({ type: "hello", name: longName }));
    expect((await firstNames).names).toContain("🙂".repeat(32));
    expect((await secondNames).names).toContain("🙂".repeat(32));

    let forgedDelivered = false;
    const markForged = () => { forgedDelivered = true; };
    second.socket.addEventListener("message", markForged, { once: true });
    first.socket.send(JSON.stringify({ type: "users", count: 1, names: ["forged"] }));
    first.socket.send(JSON.stringify({ type: "hello", name: "" }));
    await scheduler.wait(5);
    expect(forgedDelivered).toBe(false);
    second.socket.removeEventListener("message", markForged);

    // First packet (50hz magic byte) locks the room and is relayed wrapped.
    const payload = new Uint8Array([1, 52, 18, 205, 171]);
    const firstLock = nextRoom(first.socket);
    const secondLock = nextRoom(second.socket);
    const relayed = nextBinary(second.socket);
    let binaryEchoed = false;
    const markEcho = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) binaryEchoed = true;
    };
    first.socket.addEventListener("message", markEcho);
    first.socket.send(payload.buffer);
    expect(await firstLock).toEqual({ type: "room", quality: "50hz" });
    expect(await secondLock).toEqual({ type: "room", quality: "50hz" });
    const delivered = unwrap(await relayed);
    expect(delivered.sender).toBe("Ada");
    expect(delivered.packet).toEqual(payload);
    await scheduler.wait(5);
    expect(binaryEchoed).toBe(false);
    first.socket.removeEventListener("message", markEcho);
    await expectRoomList([{ name: "café", count: 2, quality: "50hz" }]);

    // A mismatched packet (25hz) is rejected, not relayed.
    let mismatchDelivered = false;
    const markMismatch = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) mismatchDelivered = true;
    };
    first.socket.addEventListener("message", markMismatch);
    const rejection = nextError(second.socket);
    second.socket.send(new Uint8Array([2, 7, 0]).buffer);
    expect(await rejection).toEqual({ type: "error", code: "quality-mismatch", quality: "50hz" });
    await scheduler.wait(5);
    expect(mismatchDelivered).toBe(false);
    first.socket.removeEventListener("message", markMismatch);

    const remaining = nextUsers(first.socket);
    second.socket.close(1000, "done");
    expect(await remaining).toEqual({ type: "users", count: 1, names: ["Ada"] });
    first.socket.close(1000, "done");
    await expectRoomList([]);

    // The lock clears once the room empties.
    const reopened = await openSocket("café");
    expect(reopened.roomInfo).toEqual({ type: "room", quality: null });
    reopened.socket.close(1000, "done");
    await expectRoomList([]);
  });

  it("locks the room from the first hello that carries a quality", async () => {
    const first = await openSocket("hello-lock");
    expect(first.roomInfo.quality).toBeNull();
    const locked = nextRoom(first.socket);
    first.socket.send(JSON.stringify({ type: "hello", name: "Ada", quality: "25hz" }));
    expect(await locked).toEqual({ type: "room", quality: "25hz" });

    const second = await openSocket("hello-lock");
    expect(second.roomInfo).toEqual({ type: "room", quality: "25hz" });

    // A later hello cannot re-lock, and bogus qualities are ignored.
    first.socket.send(JSON.stringify({ type: "hello", name: "Ada", quality: "50hz" }));
    first.socket.send(JSON.stringify({ type: "hello", name: "Ada", quality: "bogus" }));
    await scheduler.wait(5);
    const third = await openSocket("hello-lock");
    expect(third.roomInfo).toEqual({ type: "room", quality: "25hz" });
    await expectRoomList([{ name: "hello-lock", count: 3, quality: "25hz" }]);

    first.socket.close(1000, "done");
    second.socket.close(1000, "done");
    third.socket.close(1000, "done");
    await expectRoomList([]);
  });

  it("accepts the 64 KiB boundary and closes oversized or invalid frames", async () => {
    const sender = await openSocket("bounds");
    const senderUpdate = nextUsers(sender.socket);
    const receiver = await openSocket("bounds");
    await senderUpdate;

    // Legacy headerless (even-length) packets relay without locking the room.
    const boundary = new Uint8Array(64 * 1024);
    boundary[0] = 99;
    boundary[boundary.length - 1] = 42;
    const relayed = nextBinary(receiver.socket);
    sender.socket.send(boundary.buffer);
    const delivered = unwrap(await relayed);
    expect(delivered.sender).toBe("anon");
    expect(delivered.packet.byteLength).toBe(boundary.byteLength);
    expect(delivered.packet[0]).toBe(99);
    expect(delivered.packet.at(-1)).toBe(42);
    expect((await roomList())[0]?.quality ?? null).toBeNull();

    const oversizedClose = nextClose(sender.socket);
    sender.socket.send(new ArrayBuffer(64 * 1024 + 1));
    expect((await oversizedClose).code).toBe(1009);

    const invalid = await openSocket("invalid-packet");
    const invalidClose = nextClose(invalid.socket);
    invalid.socket.send(new Uint8Array([9, 1, 0]).buffer);
    expect((await invalidClose).code).toBe(1003);

    // 0xFE is reserved for the sender wrap; even a well-formed
    // even-length payload starting with it must be refused at ingress.
    const reserved = await openSocket("reserved-marker");
    const reservedClose = nextClose(reserved.socket);
    reserved.socket.send(new Uint8Array([0xfe, 3, 65, 100]).buffer);
    expect((await reservedClose).code).toBe(1003);
    receiver.socket.close(1000, "done");
  });

  it("closes an oversized text control frame before parsing it", async () => {
    const connection = await openSocket("control-bounds");
    const closed = nextClose(connection.socket);
    connection.socket.send("x".repeat(1025));
    expect((await closed).code).toBe(1009);
  });

  it("preserves hibernatable sockets, attachments, and the quality lock across eviction", async () => {
    const first = await openSocket("hibernate");
    let firstUpdate = nextUsers(first.socket);
    first.socket.send(JSON.stringify({ type: "hello", name: "Ada" }));
    await firstUpdate;

    firstUpdate = nextUsers(first.socket);
    const second = await openSocket("hibernate");
    await firstUpdate;
    const bothFirst = nextUsers(first.socket);
    const bothSecond = nextUsers(second.socket);
    second.socket.send(JSON.stringify({ type: "hello", name: "Grace" }));
    await Promise.all([bothFirst, bothSecond]);

    await evictDurableObject(env.ROOMS.getByName("hibernate"));

    // First packet locks (25hz) even though the DO was evicted in between.
    const locked = nextRoom(second.socket);
    const relayed = nextBinary(second.socket);
    first.socket.send(new Uint8Array([2, 7, 0]).buffer);
    expect(await locked).toEqual({ type: "room", quality: "25hz" });
    const delivered = unwrap(await relayed);
    expect(delivered.sender).toBe("Ada");
    expect(delivered.packet).toEqual(new Uint8Array([2, 7, 0]));

    // The lock survives another eviction (it lives in DO storage).
    await evictDurableObject(env.ROOMS.getByName("hibernate"));
    const rejection = nextError(second.socket);
    second.socket.send(new Uint8Array([1, 1, 2]).buffer);
    expect(await rejection).toEqual({ type: "error", code: "quality-mismatch", quality: "25hz" });

    const afterEvictionFirst = nextUsers(first.socket);
    const afterEvictionSecond = nextUsers(second.socket);
    first.socket.send(JSON.stringify({ type: "hello", name: "Ada 2" }));
    expect([...(await afterEvictionFirst).names].sort()).toEqual(["Ada 2", "Grace"]);
    expect([...(await afterEvictionSecond).names].sort()).toEqual(["Ada 2", "Grace"]);
    first.socket.close(1000, "done");
    second.socket.close(1000, "done");
  });
});

describe("Lobby Durable Object", () => {
  it("keeps a quiet room listed while a hibernating socket remains connected", async () => {
    const active = await openSocket("quiet-room");
    const lobby = env.LOBBY.getByName("main");
    await runInDurableObject(lobby, async (_instance, state) => {
      await state.storage.put("rooms", {
        "quiet-room": { count: 1, lastUpdated: Date.now() - 11 * 60 * 1000 },
      });
    });

    expect(await runDurableObjectAlarm(lobby)).toBe(true);
    expect(await roomList()).toEqual([{ name: "quiet-room", count: 1, quality: null }]);

    active.socket.close(1000, "done");
    await expectRoomList([]);
  });

  it("preserves a stored quality through reconciliation", async () => {
    const active = await openSocket("sticky");
    const lobby = env.LOBBY.getByName("main");
    await runInDurableObject(lobby, async (_instance, state) => {
      await state.storage.put("rooms", {
        sticky: { count: 1, lastUpdated: Date.now() - 11 * 60 * 1000, quality: "12_5hz" },
      });
    });

    expect(await runDurableObjectAlarm(lobby)).toBe(true);
    expect(await roomList()).toEqual([{ name: "sticky", count: 1, quality: "12_5hz" }]);
    active.socket.close(1000, "done");
    await expectRoomList([]);
  });

  it("keeps no alarm when empty, schedules active cleanup, and removes stale rooms", async () => {
    const lobby = env.LOBBY.getByName("main");
    expect(await roomList()).toEqual([]);
    expect(await runInDurableObject(lobby, (_instance, state) => state.storage.getAlarm())).toBeNull();

    let response = await lobby.fetch("http://internal/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: "odin", count: 1 }),
    });
    expect(response.ok).toBe(true);
    expect(await runInDurableObject(lobby, (_instance, state) => state.storage.getAlarm())).not.toBeNull();

    await runInDurableObject(lobby, async (_instance, state) => {
      await state.storage.put("rooms", {
        odin: { count: 1, lastUpdated: Date.now() - 11 * 60 * 1000 },
      });
    });
    expect(await runDurableObjectAlarm(lobby)).toBe(true);
    expect(await roomList()).toEqual([]);
    expect(await runInDurableObject(lobby, (_instance, state) => state.storage.getAlarm())).toBeNull();

    response = await lobby.fetch("http://internal/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: "odin", count: -1 }),
    });
    expect(response.status).toBe(400);
  });

  it("migrates the prior numeric room-count storage shape", async () => {
    const lobby = env.LOBBY.getByName("main");
    await runInDurableObject(lobby, async (_instance, state) => {
      await state.storage.put("rooms", { legacy: 2 });
    });
    const response = await lobby.fetch("http://internal/list");
    expect(await response.json()).toEqual([{ name: "legacy", count: 2, quality: null }]);
  });
});
