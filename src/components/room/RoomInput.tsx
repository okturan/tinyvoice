import { useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import ArrowNarrowRightIcon from "@/components/ui/arrow-narrow-right-icon";
import RefreshIcon from "@/components/ui/refresh-icon";
import { randomRoomName } from "@/lib/utils/names";

interface RoomInputProps {
  onJoin: (name: string) => void;
}

export function RoomInput({ onJoin }: RoomInputProps) {
  const [value, setValue] = useState("");

  const handleJoin = () => {
    const trimmed = value.trim();
    if (trimmed) onJoin(trimmed);
  };

  const handleShuffle = () => {
    setValue(randomRoomName());
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") handleJoin();
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex overflow-hidden rounded-lg border border-input bg-background">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="room name"
          spellCheck={false}
          autoComplete="off"
          className="border-0 font-mono focus-visible:ring-0"
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={handleJoin}
          title="Join room"
          className="shrink-0 rounded-none border-l border-input"
        >
          <ArrowNarrowRightIcon size={16} />
        </Button>
      </div>
      <Button
        variant="ghost"
        size="xs"
        onClick={handleShuffle}
        className="w-fit gap-1 text-muted-foreground"
      >
        <RefreshIcon size={12} />
        random
      </Button>
    </div>
  );
}
