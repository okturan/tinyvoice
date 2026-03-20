import { cn } from "@/lib/utils";

interface RoomItemProps {
  name: string;
  count?: number;
  onJoin: (name: string) => void;
}

export function RoomItem({ name, count, onJoin }: RoomItemProps) {
  return (
    <button
      onClick={() => onJoin(name)}
      className={cn(
        "flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors",
        "hover:border-border hover:bg-muted",
        "group",
      )}
    >
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full transition-colors",
          count ? "bg-green-500" : "bg-muted-foreground/30",
          "group-hover:bg-primary",
        )}
      />
      <span className="truncate font-mono text-xs text-muted-foreground transition-colors group-hover:text-foreground">
        {name}
      </span>
      {count ? (
        <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {count}
        </span>
      ) : null}
      <span className="ml-auto shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
        Join
      </span>
    </button>
  );
}
