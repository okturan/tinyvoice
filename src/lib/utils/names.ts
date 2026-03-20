const USER_ADJECTIVES = [
  "swift",
  "bold",
  "quiet",
  "bright",
  "dark",
  "warm",
  "cool",
  "wild",
  "calm",
  "keen",
  "brave",
  "sly",
  "pale",
  "deep",
  "soft",
  "sharp",
  "tall",
  "rare",
  "fair",
  "grey",
] as const;

const USER_NOUNS = [
  "raven",
  "wolf",
  "fox",
  "hawk",
  "bear",
  "lynx",
  "owl",
  "deer",
  "crane",
  "seal",
  "wren",
  "hare",
  "pike",
  "moth",
  "vole",
  "newt",
  "toad",
  "crow",
  "lark",
  "shrew",
] as const;

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

export function randomUsername(): string {
  return `${pick(USER_ADJECTIVES)}-${pick(USER_NOUNS)}`;
}

export function randomRoomName(): string {
  return `${pick(ROOM_ADJECTIVES)}-${pick(ROOM_NOUNS)}`;
}
