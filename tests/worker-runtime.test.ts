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

async function workerFetch(path: string, init?: RequestInit): Promise<Response> {
  return workerExports.default.fetch(new Request(`https://relay.test${path}`, init));
}

function nextMessage(socket: WebSocket): Promise<MessageEvent> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      cleanup();
      resolve(event);
    };
    const onClose = (event: CloseEvent) => {
      cleanup();
      reject(new Error(`socket closed before message (${event.code})`));
    };
    const cleanup = () => {
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
  });
}

async function nextUsers(socket: WebSocket): Promise<UsersPayload> {
  const event = await nextMessage(socket);
  expect(typeof event.data).toBe("string");
  return JSON.parse(event.data as string) as UsersPayload;
}

function nextClose(socket: WebSocket): Promise<CloseEvent> {
  return new Promise((resolve) => {
    socket.addEventListener("close", resolve, { once: true });
  });
}

async function openSocket(room: string): Promise<{ socket: WebSocket; initial: UsersPayload }> {
  const response = await workerFetch(`/ws/${encodeURIComponent(room)}`, {
    headers: { Upgrade: "websocket" },
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  expect(socket).not.toBeNull();
  socket!.binaryType = "arraybuffer";
  const initial = nextUsers(socket!);
  socket!.accept();
  return { socket: socket!, initial: await initial };
}

afterEach(async () => {
  await reset();
});

async function roomList(): Promise<Array<{ name: string; count: number }>> {
  const response = await workerFetch("/rooms");
  expect(response.ok).toBe(true);
  return response.json();
}

async function expectRoomList(expected: Array<{ name: string; count: number }>): Promise<void> {
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
  it("canonicalizes room identity, validates control frames, and relays bytes exactly", async () => {
    const first = await openSocket(" café ");
    expect(first.initial).toEqual({ type: "users", count: 1, names: ["anon"] });

    let update = nextUsers(first.socket);
    first.socket.send(JSON.stringify({ type: "hello", name: " Ada " }));
    expect(await update).toEqual({ type: "users", count: 1, names: ["Ada"] });

    update = nextUsers(first.socket);
    const second = await openSocket("cafe\u0301");
    expect([...(await update).names].sort()).toEqual(["Ada", "anon"]);
    expect([...second.initial.names].sort()).toEqual(["Ada", "anon"]);
    expect(await roomList()).toEqual([{ name: "café", count: 2 }]);

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

    const payload = new Uint8Array([1, 52, 18, 205, 171]);
    const relayed = nextMessage(second.socket);
    let senderEchoed = false;
    const markEcho = () => { senderEchoed = true; };
    first.socket.addEventListener("message", markEcho, { once: true });
    first.socket.send(payload.buffer);
    expect(new Uint8Array((await relayed).data as ArrayBuffer)).toEqual(payload);
    await scheduler.wait(5);
    expect(senderEchoed).toBe(false);
    first.socket.removeEventListener("message", markEcho);

    const remaining = nextUsers(first.socket);
    second.socket.close(1000, "done");
    expect(await remaining).toEqual({ type: "users", count: 1, names: ["Ada"] });
    first.socket.close(1000, "done");
    await expectRoomList([]);
  });

  it("accepts the 64 KiB boundary and closes oversized or invalid frames", async () => {
    const sender = await openSocket("bounds");
    const senderUpdate = nextUsers(sender.socket);
    const receiver = await openSocket("bounds");
    await senderUpdate;

    const boundary = new Uint8Array(64 * 1024);
    boundary[0] = 99;
    boundary[boundary.length - 1] = 42;
    const relayed = nextMessage(receiver.socket);
    sender.socket.send(boundary.buffer);
    const received = new Uint8Array((await relayed).data as ArrayBuffer);
    expect(received.byteLength).toBe(boundary.byteLength);
    expect(received[0]).toBe(99);
    expect(received.at(-1)).toBe(42);

    const oversizedClose = nextClose(sender.socket);
    sender.socket.send(new ArrayBuffer(64 * 1024 + 1));
    expect((await oversizedClose).code).toBe(1009);

    const invalid = await openSocket("invalid-packet");
    const invalidClose = nextClose(invalid.socket);
    invalid.socket.send(new Uint8Array([9, 1, 0]).buffer);
    expect((await invalidClose).code).toBe(1003);
    receiver.socket.close(1000, "done");
  });

  it("closes an oversized text control frame before parsing it", async () => {
    const connection = await openSocket("control-bounds");
    const closed = nextClose(connection.socket);
    connection.socket.send("x".repeat(1025));
    expect((await closed).code).toBe(1009);
  });

  it("preserves hibernatable sockets and name attachments across eviction", async () => {
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
    const relayed = nextMessage(second.socket);
    first.socket.send(new Uint8Array([2, 7, 0]).buffer);
    expect(new Uint8Array((await relayed).data as ArrayBuffer)).toEqual(new Uint8Array([2, 7, 0]));

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
    expect(await roomList()).toEqual([{ name: "quiet-room", count: 1 }]);

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
    expect(await response.json()).toEqual([{ name: "legacy", count: 2 }]);
  });
});
