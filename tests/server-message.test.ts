import { describe, expect, it } from "vitest";
import {
  isUsersMessage,
  normalizeDisplayName,
  normalizeRoomName,
  parseLobbyRooms,
  parseServerMessage,
  shouldReconnect,
} from "@/lib/ws/relay";

describe("server message validation", () => {
  it("accepts only complete, internally consistent user lists", () => {
    const valid = { type: "users", count: 2, names: ["Ada", "Grace"] };
    expect(isUsersMessage(valid)).toBe(true);
    expect(parseServerMessage(JSON.stringify(valid))).toEqual(valid);
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

describe("lobby response validation", () => {
  it("accepts bounded room records", () => {
    expect(parseLobbyRooms([{ name: "bifrost", count: 2 }])).toEqual([
      { name: "bifrost", count: 2 },
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
