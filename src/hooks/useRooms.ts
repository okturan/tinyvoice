import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeRoomName, parseLobbyRooms, RELAY_HTTP, type LobbyRoom } from "@/lib/ws/relay";

const POLL_INTERVAL = 10_000;
const MAX_RECENT = 6;
const STORAGE_KEY = "fc-rooms";

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const rooms: string[] = [];
      for (const value of parsed) {
        const room = normalizeRoomName(value);
        if (room && !rooms.includes(room)) rooms.push(room);
      }
      return rooms.slice(0, MAX_RECENT);
    }
    return [];
  } catch {
    return [];
  }
}

function saveRecent(rooms: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
}

export interface UseRoomsReturn {
  activeRooms: LobbyRoom[];
  recentRooms: string[];
  addRecentRoom: (name: string) => void;
  isPolling: boolean;
  startPolling: () => void;
  stopPolling: () => void;
}

export function useRooms(): UseRoomsReturn {
  const [activeRooms, setActiveRooms] = useState<LobbyRoom[]>([]);
  const [recentRooms, setRecentRooms] = useState<string[]>(loadRecent);
  const [isPolling, setIsPolling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRooms = useCallback(async () => {
    try {
      const res = await fetch(`${RELAY_HTTP}/rooms`);
      if (!res.ok) throw new Error(`Room list returned HTTP ${res.status}`);
      const data: unknown = await res.json();
      const rooms = parseLobbyRooms(data);
      if (!rooms) throw new Error("Room list returned an invalid payload");
      setActiveRooms(rooms);
    } catch {
      setActiveRooms([]);
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    setIsPolling(true);
    void fetchRooms();
    pollRef.current = setInterval(() => void fetchRooms(), POLL_INTERVAL);
  }, [fetchRooms]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const addRecentRoom = useCallback((name: string) => {
    const room = normalizeRoomName(name);
    if (!room) return;
    setRecentRooms((prev) => {
      const next = [room, ...prev.filter((x) => x !== room)].slice(
        0,
        MAX_RECENT,
      );
      saveRecent(next);
      return next;
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, []);

  return {
    activeRooms,
    recentRooms,
    addRecentRoom,
    isPolling,
    startPolling,
    stopPolling,
  };
}
