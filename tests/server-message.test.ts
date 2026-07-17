import { describe, expect, it } from "vitest";
import {
  isUsersMessage,
  normalizeDisplayName,
  normalizeRoomName,
  parseLobbyRooms,
  parseServerMessage,
  shouldReconnect,
  unwrapRelayPayload,
  RELAY_WRAP_MARKER,
} from "@/lib/ws/relay";

describe("server message validation", () => {
  it("accepts only complete, internally consistent user lists", () => {
    const valid = { type: "users", count: 2, names: ["Ada", "Grace"] };
    expect(isUsersMessage(valid)).toBe(true);
    expect(parseServerMessage(JSON.stringify(valid))).toEqual(valid);
  });

  it("accepts room-quality and relay-error control messages", () => {
    expect(parseServerMessage(JSON.stringify({ type: "room", quality: "25hz" })))
      .toEqual({ type: "room", quality: "25hz" });
    expect(parseServerMessage(JSON.stringify({ type: "room", quality: null })))
      .toEqual({ type: "room", quality: null });
    expect(parseServerMessage(JSON.stringify({ type: "room", quality: "60hz" }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: "error", code: "quality-mismatch", quality: "50hz" })))
      .toEqual({ type: "error", code: "quality-mismatch", quality: "50hz" });
    expect(parseServerMessage(JSON.stringify({ type: "error" }))).toBeNull();
  });

  it.each([
    null,
    {},
    { type: "hello", count: 0, names: [] },
    { type: "users", count: -1, names: [] },
    { type: "users", count: 0.5, names: [] },
    { type: "users", count: 2, names: ["Ada"] },
    { type: "users", count: 1, names: [7] },
    { type: "users", count: 1, names: [""] },
    { type: "users", count: 1, names: ["a".repeat(33)] },
    { type: "users", count: 1, names: ["bad\nname"] },
  ])("rejects malformed user-list payload %#", (value) => {
    expect(isUsersMessage(value)).toBe(false);
  });

  it("returns null for malformed JSON", () => {
    expect(parseServerMessage("{" )).toBeNull();
  });
});

describe("client protocol normalization", () => {
  it("mirrors server room and display-name limits", () => {
    expect(normalizeRoomName(" cafe\u0301 ")).toBe("café");
    expect(normalizeRoomName("bad/room")).toBeNull();
    expect(normalizeRoomName("..")).toBeNull();
    expect(normalizeRoomName("a".repeat(65))).toBeNull();
    expect(normalizeDisplayName(" Ada ")).toBe("Ada");
    expect(normalizeDisplayName("🙂".repeat(40))).toBe("🙂".repeat(32));
    expect(normalizeDisplayName("bad\nname")).toBeNull();
  });

  it("retries transient closes only for a bounded number of attempts", () => {
    expect(shouldReconnect(1006, 0)).toBe(true);
    expect(shouldReconnect(1006, 5)).toBe(false);
    expect(shouldReconnect(1009, 0)).toBe(false);
    expect(shouldReconnect(1000, 0)).toBe(false);
  });
});

describe("relay payload unwrapping", () => {
  it("extracts the sender name and packet from a wrapped payload", () => {
    const name = new TextEncoder().encode("Ada");
    const packet = new Uint8Array([2, 7, 0]);
    const wrapped = new Uint8Array(2 + name.length + packet.length);
    wrapped[0] = RELAY_WRAP_MARKER;
    wrapped[1] = name.length;
    wrapped.set(name, 2);
    wrapped.set(packet, 2 + name.length);

    const result = unwrapRelayPayload(wrapped.buffer);
    expect(result.sender).toBe("Ada");
    expect(new Uint8Array(result.packet)).toEqual(packet);
  });

  it("passes unwrapped payloads through with a null sender", () => {
    const packet = new Uint8Array([2, 7, 0]);
    const result = unwrapRelayPayload(packet.buffer);
    expect(result.sender).toBeNull();
    expect(new Uint8Array(result.packet)).toEqual(packet);
  });

  it("treats a truncated wrap header as a raw packet", () => {
    const bogus = new Uint8Array([RELAY_WRAP_MARKER, 200, 1, 2]);
    const result = unwrapRelayPayload(bogus.buffer);
    expect(result.sender).toBeNull();
    expect(new Uint8Array(result.packet)).toEqual(bogus);
  });
});

describe("lobby response validation", () => {
  it("accepts bounded room records and normalizes quality", () => {
    expect(parseLobbyRooms([{ name: "bifrost", count: 2, quality: "25hz" }])).toEqual([
      { name: "bifrost", count: 2, quality: "25hz" },
    ]);
    expect(parseLobbyRooms([{ name: "bifrost", count: 2 }])).toEqual([
      { name: "bifrost", count: 2, quality: null },
    ]);
    expect(parseLobbyRooms([{ name: "bifrost", count: 2, quality: "bogus" }])).toEqual([
      { name: "bifrost", count: 2, quality: null },
    ]);
  });

  it.each([
    {},
    [null],
    [{ name: "", count: 1 }],
    [{ name: "bad/room", count: 1 }],
    [{ name: "room", count: -1 }],
    [{ name: "room", count: 1.2 }],
    [{ name: "room", count: 65 }],
  ])("rejects malformed lobby payload %#", (value) => {
    expect(parseLobbyRooms(value)).toBeNull();
  });
});
