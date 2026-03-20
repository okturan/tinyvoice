import { useStats } from "@/contexts/StatsContext";
import { THEMES, type ThemeId } from "@/lib/constants";
import { fmt } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface HeaderProps {
  theme: ThemeId;
  onThemeChange: (id: ThemeId) => void;
}

export function Header({ theme, onThemeChange }: HeaderProps) {
  const { totalSent, totalRecv, userCount } = useStats();

  return (
    <div className="col-span-full flex items-center gap-2.5 px-4.5 bg-[var(--mantle)] border-b border-[var(--surface0)] h-11">
      <h1 className="text-[0.95rem] font-bold text-[var(--text)]">
        TinyVoice
      </h1>
      <Badge
        variant="secondary"
        className="text-[0.55rem] px-2 py-0.5 bg-[var(--surface0)] text-[var(--overlay)] rounded-xl font-semibold tracking-wider border-0"
      >
        PTT
      </Badge>
      <span className="flex-1" />

      {/* Stats */}
      <div className="font-mono text-[0.72rem] text-[var(--overlay)] flex gap-3">
        <span>
          sent <b className="text-[var(--accent)] font-semibold">{fmt(totalSent)}</b>
        </span>
        <span>
          recv <b className="text-[var(--accent)] font-semibold">{fmt(totalRecv)}</b>
        </span>
        <span>
          users <b className="text-[var(--accent)] font-semibold">{userCount}</b>
        </span>
      </div>

      {/* Theme dots */}
      <div className="flex gap-1 ml-2.5 pl-2.5 border-l border-[var(--surface0)]">
        {THEMES.map((t) => (
          <Tooltip key={t.id}>
            <TooltipTrigger asChild>
              <button
                className="w-3.5 h-3.5 rounded-full border-2 cursor-pointer transition-all duration-150 hover:scale-115"
                style={{
                  background: t.swatch,
                  borderColor: theme === t.id ? "var(--text)" : "transparent",
                }}
                onClick={() => onThemeChange(t.id)}
              />
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {t.label}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
