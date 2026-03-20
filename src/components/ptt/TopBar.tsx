import { Settings } from "lucide-react";
import { useThemeContext } from "@/contexts/ThemeContext";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TopBarProps {
  onSettingsOpen: () => void;
}

export function TopBar({ onSettingsOpen }: TopBarProps) {
  const { theme, setTheme, themes } = useThemeContext();

  return (
    <div className="h-12 bg-[var(--mantle)] border-b border-[var(--surface0)] flex items-center px-4 flex-shrink-0">
      {/* Left: brand */}
      <h1 className="text-[0.95rem] font-bold text-[var(--text)]">
        TinyVoice
      </h1>

      {/* Center: nav pills */}
      <div className="flex-1 flex items-center justify-center gap-1">
        <span className="px-3 py-1 rounded-full bg-[var(--tv-accent)] text-[var(--crust)] text-[0.65rem] font-semibold tracking-wide">
          PTT
        </span>
        <a
          href="/qr"
          className="px-3 py-1 rounded-full bg-[var(--surface0)] text-[var(--overlay)] text-[0.65rem] font-semibold tracking-wide no-underline transition-colors hover:bg-[var(--surface1)] hover:text-[var(--subtext)]"
        >
          QR
        </a>
      </div>

      {/* Right: settings + theme dots */}
      <div className="flex items-center gap-2">
        <button
          onClick={onSettingsOpen}
          className="p-1.5 rounded-md text-[var(--overlay)] transition-colors hover:text-[var(--text)] hover:bg-[var(--surface0)] cursor-pointer"
          title="Settings"
        >
          <Settings className="w-4 h-4" />
        </button>

        <div className="flex gap-1 pl-2 border-l border-[var(--surface0)]">
          {themes.map((t) => (
            <Tooltip key={t.id}>
              <TooltipTrigger asChild>
                <button
                  className="w-3 h-3 rounded-full border-2 cursor-pointer transition-all duration-150 hover:scale-115"
                  style={{
                    background: t.swatch,
                    borderColor: theme === t.id ? "var(--text)" : "transparent",
                    ...(t.id === "midnight"
                      ? { boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.1)" }
                      : {}),
                  }}
                  onClick={() => setTheme(t.id)}
                />
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {t.label}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>
    </div>
  );
}
