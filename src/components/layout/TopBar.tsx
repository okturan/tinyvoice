import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import GearIcon from "@/components/ui/gear-icon";
import { SettingsSheet } from "@/components/layout/SettingsSheet";

export function TopBar() {
  const location = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <div className="h-12 bg-[var(--mantle)] border-b border-[var(--surface0)] flex items-center px-4 gap-3">
        {/* Left: Brand */}
        <span className="text-sm font-bold text-[var(--text)]">TinyVoice</span>

        {/* Center: Nav pills */}
        <nav className="flex gap-0.5 ml-2">
          <Link
            to="/"
            className={`px-2.5 py-0.5 rounded text-[0.65rem] font-semibold no-underline transition-colors ${
              location.pathname === "/"
                ? "bg-[var(--surface0)] text-[var(--text)]"
                : "text-[var(--overlay)] hover:text-[var(--subtext)] hover:bg-[var(--surface0)]/50"
            }`}
          >
            PTT
          </Link>
          <Link
            to="/qr"
            className={`px-2.5 py-0.5 rounded text-[0.65rem] font-semibold no-underline transition-colors ${
              location.pathname === "/qr"
                ? "bg-[var(--surface0)] text-[var(--text)]"
                : "text-[var(--overlay)] hover:text-[var(--subtext)] hover:bg-[var(--surface0)]/50"
            }`}
          >
            QR
          </Link>
        </nav>

        <span className="flex-1" />

        {/* Right: Settings gear */}
        <button
          className="p-2 flex items-center justify-center text-[var(--overlay)] hover:text-[var(--text)] transition-colors cursor-pointer"
          onClick={() => setSettingsOpen(true)}
        >
          <GearIcon size={16} />
        </button>

      </div>

      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
