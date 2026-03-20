import { useEffect } from "react";
import { Input } from "@/components/ui/input";
import { useRoom } from "@/contexts/RoomContext";
import { randomUsername } from "@/lib/utils/names";

export function UsernameInput() {
  const { username, setUsername } = useRoom();

  // Generate a random username if none is stored
  useEffect(() => {
    if (!username) {
      setUsername(randomUsername());
    }
  }, [username, setUsername]);

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor="username"
        className="text-xs font-semibold tracking-wider text-muted-foreground uppercase"
      >
        You
      </label>
      <Input
        id="username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="your name"
        spellCheck={false}
        className="font-mono"
      />
    </div>
  );
}
