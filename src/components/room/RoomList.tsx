import { useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RoomItem } from "./RoomItem";

const SUGGESTED_ROOMS = ["odin", "valhalla", "bifrost", "midgard", "asgard"];

interface RoomListProps {
  activeRooms: { name: string; count: number }[];
  recentRooms: string[];
  onJoin: (name: string) => void;
}

export function RoomList({ activeRooms, recentRooms, onJoin }: RoomListProps) {
  const items = useMemo((): { name: string; count?: number }[] => {
    if (activeRooms.length > 0) {
      return activeRooms.map((r) => ({ name: r.name, count: r.count }));
    }
    if (recentRooms.length > 0) {
      return recentRooms.map((name) => ({ name }));
    }
    return SUGGESTED_ROOMS.map((name) => ({ name }));
  }, [activeRooms, recentRooms]);

  return (
    <ScrollArea className="max-h-40">
      <div className="flex flex-col gap-px">
        {items.map((item) => (
          <RoomItem
            key={item.name}
            name={item.name}
            count={item.count}
            onJoin={onJoin}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
