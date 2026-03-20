import {
  ADJECTIVES,
  NOUNS,
  ROOM_ADJ,
  ROOM_NOUN,
} from "@/lib/constants";

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export function randomName(): string {
  return pick(ADJECTIVES) + "-" + pick(NOUNS);
}

export function randomRoomName(): string {
  return pick(ROOM_ADJ) + "-" + pick(ROOM_NOUN);
}
