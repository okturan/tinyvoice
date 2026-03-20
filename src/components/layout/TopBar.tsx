import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
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
        <nav className="flex gap-1 ml-2">
          <Button
            variant="ghost"
            size="sm"
            asChild
            className={`min-h-[44px] min-w-[44px] text-xs ${
              location.pathname === "/"
                ? "bg-[var(--surface0)] text-[var(--text)]"
                : "text-[var(--overlay)]"
            }`}
          >
            <Link to="/">PTT</Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            asChild
            className={`min-h-[44px] min-w-[44px] text-xs ${
              location.pathname === "/qr"
                ? "bg-[var(--surface0)] text-[var(--text)]"
                : "text-[var(--overlay)]"
            }`}
          >
            <Link to="/qr">QR</Link>
          </Button>
        </nav>

        <span className="flex-1" />

        {/* Right: Settings gear */}
        <button
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[var(--overlay)] hover:text-[var(--text)] transition-colors cursor-pointer"
          onClick={() => setSettingsOpen(true)}
        >
          <GearIcon size={16} />
        </button>

      </div>

      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
