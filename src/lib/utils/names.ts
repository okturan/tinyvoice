const ROOM_ADJECTIVES = [
  "hidden",
  "golden",
  "iron",
  "silver",
  "frost",
  "storm",
  "shadow",
  "ember",
  "crystal",
  "silent",
  "ancient",
  "copper",
  "hollow",
  "misty",
  "broken",
  "cobalt",
  "scarlet",
  "moss",
  "drift",
  "ashen",
] as const;

const ROOM_NOUNS = [
  "hall",
  "bridge",
  "forge",
  "tower",
  "grove",
  "vale",
  "peak",
  "gate",
  "den",
  "keep",
  "reef",
  "ridge",
  "well",
  "cairn",
  "knoll",
  "cove",
  "bluff",
  "arch",
  "ford",
  "ledge",
] as const;

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export function randomRoomName(): string {
  return `${pick(ROOM_ADJECTIVES)}-${pick(ROOM_NOUNS)}`;
}
