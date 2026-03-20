const STORAGE_KEY = "fc-rooms";

export function getRecentRooms(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

export function addRecentRoom(name: string): void {
  const rooms = getRecentRooms().filter((x) => x !== name);
  rooms.unshift(name);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms.slice(0, 6)));
}
