import { Button } from "@/components/ui/button";
import XIcon from "@/components/ui/x-icon";
import { useRoom } from "@/contexts/RoomContext";
import { UserTag } from "./UserTag";
import { cn } from "@/lib/utils";

export function RoomActiveCard() {
  const { currentRoom, users, userCount, isConnected, leaveRoom } = useRoom();

  if (!currentRoom) return null;

  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          "flex items-center gap-3 rounded-xl border p-3.5 transition-colors",
          isConnected
            ? "border-primary/15 bg-primary/5"
            : "border-yellow-500/20 bg-yellow-500/5",
        )}
      >
        {/* Beacon */}
        <div className="relative flex size-8 shrink-0 items-center justify-center">
          <div
            className={cn(
              "absolute inset-0 animate-beacon rounded-full border-[1.5px] opacity-25",
              isConnected ? "border-primary" : "border-yellow-500",
            )}
          />
          <div
            className={cn(
              "relative z-10 size-2.5 rounded-full",
              isConnected
                ? "bg-primary shadow-[0_0_10px_var(--primary)]"
                : "bg-yellow-500 shadow-[0_0_10px_oklch(0.8_0.15_85)]",
            )}
          />
        </div>

        {/* Room info */}
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-sm font-semibold">
            {currentRoom}
          </div>
          <div className="text-xs text-muted-foreground">
            {isConnected
              ? `${userCount} connected`
              : "Connecting..."}
          </div>
        </div>
      </div>

      {/* User tags */}
      {users.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {users.map((name) => (
            <UserTag key={name} name={name} />
          ))}
        </div>
      )}

      {/* Leave button */}
      <Button
        variant="destructive"
        onClick={leaveRoom}
        className="w-full gap-1.5"
      >
        <XIcon size={14} />
        Leave
      </Button>
    </div>
  );
}
