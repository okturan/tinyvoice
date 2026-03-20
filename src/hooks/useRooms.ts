import { useCallback, useEffect, useRef, useState } from "react";
import { RELAY_HTTP, type LobbyRoom } from "@/lib/ws/relay";

const POLL_INTERVAL = 10_000;
const MAX_RECENT = 6;
const STORAGE_KEY = "fc-rooms";

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === "string");
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
      const data: LobbyRoom[] = await res.json();
      setActiveRooms(data);
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
    setRecentRooms((prev) => {
      const next = [name, ...prev.filter((x) => x !== name)].slice(
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
