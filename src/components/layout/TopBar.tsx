import { Link, useLocation } from "react-router-dom";
import { useThemeContext } from "@/contexts/ThemeContext";
import { Settings } from "lucide-react";
import { useState } from "react";

export function TopBar() {
  const { theme, setTheme, themes } = useThemeContext();
  const location = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const isPTT = location.pathname === "/";
  const isQR = location.pathname === "/qr";

  return (
    <div className="h-12 bg-[var(--mantle)] border-b border-[var(--surface0)] flex items-center px-4">
      {/* Left: Brand */}
      <h1 className="text-[0.95rem] font-bold text-[var(--text)]">TinyVoice</h1>

      {/* Center: Nav pills */}
      <div className="flex-1 flex justify-center">
        <div className="flex rounded-lg bg-[var(--surface0)] p-0.5 gap-0.5">
          <Link
            to="/"
            className={`px-3 py-1 rounded-md text-xs font-medium no-underline transition-colors ${
              isPTT
                ? "bg-[var(--tv-accent)] text-[var(--crust)]"
                : "text-[var(--overlay)] hover:text-[var(--text)]"
            }`}
          >
            PTT
          </Link>
          <Link
            to="/qr"
            className={`px-3 py-1 rounded-md text-xs font-medium no-underline transition-colors ${
              isQR
                ? "bg-[var(--tv-accent)] text-[var(--crust)]"
                : "text-[var(--overlay)] hover:text-[var(--text)]"
            }`}
          >
            QR
          </Link>
        </div>
      </div>

      {/* Right: Settings gear + theme dots */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setSettingsOpen(!settingsOpen)}
          className="p-1 rounded-md text-[var(--overlay)] hover:text-[var(--text)] hover:bg-[var(--surface0)] transition-colors cursor-pointer"
        >
          <Settings className="size-4" />
        </button>

        {settingsOpen && (
          <div className="flex items-center gap-1">
            {themes.map((t) => (
              <button
                key={t.id}
                title={t.label}
                onClick={() => setTheme(t.id)}
                className={`size-3.5 rounded-full border-2 cursor-pointer transition-all duration-150 hover:scale-115 ${
                  t.id === "midnight" ? "ring-1 ring-inset ring-white/10" : ""
                }`}
                style={{
                  backgroundColor: t.swatch,
                  borderColor: theme === t.id ? "var(--text)" : "transparent",
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
