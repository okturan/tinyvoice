import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { useThemeContext } from "@/contexts/ThemeContext";
import { useCodecContext } from "@/contexts/CodecContext";
import { ModelManagement } from "@/components/codec/ModelManagement";

interface SettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsSheet({ open, onOpenChange }: SettingsSheetProps) {
  const { theme, setTheme, themes } = useThemeContext();
  const codec = useCodecContext();
  const [username, setUsername] = useState(
    () => (typeof localStorage !== "undefined" ? localStorage.getItem("fc-username") || "" : "")
  );

  const [confirmClear, setConfirmClear] = useState(false);

  const handleUsernameChange = (value: string) => {
    setUsername(value);
    localStorage.setItem("fc-username", value);
  };

  const handleClear = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    codec.clearModelCache();
    setConfirmClear(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent onOpenAutoFocus={e => e.preventDefault()} className="bg-[var(--mantle)] border-l border-[var(--surface0)] overflow-y-auto text-[var(--text)]">
        <SheetHeader className="px-6 pt-6 pb-2">
          <SheetTitle className="text-[var(--text)] text-base font-semibold">Settings</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-6 py-4">
          {/* Username */}
          <div>
            <label className="text-[0.65rem] uppercase tracking-[0.15em] text-[var(--overlay)] font-semibold">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={e => handleUsernameChange(e.target.value)}
              placeholder="your name"
              spellCheck={false}
              className="w-full mt-1.5 px-3 py-2 rounded-md bg-[var(--base)] border border-[var(--surface0)] text-[var(--text)] font-mono text-[0.8rem] outline-none focus:border-[var(--surface1)] transition-colors"
            />
          </div>

          <Separator className="bg-[var(--surface0)]" />

          {/* Codec */}
          <div>
            <label className="text-[0.65rem] uppercase tracking-[0.15em] text-[var(--overlay)] font-semibold">
              Codec
            </label>
            <div className="mt-2 flex items-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${codec.modelsLoaded ? "bg-[var(--green)]" : "bg-[var(--surface2)]"}`} />
              <span className="text-[0.7rem] text-[var(--subtext)] font-mono">{codec.statusText}</span>
            </div>
            {codec.state === "loading" && (
              <Progress value={codec.progress} className="mt-2 h-1.5" />
            )}
            <div className="flex gap-2 mt-2.5">
              <button
                onClick={() => codec.loadModels()}
                disabled={codec.modelsLoaded || codec.state === "loading"}
                className="flex-1 py-2 rounded-md text-[0.7rem] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                {codec.state === "loading" ? "Downloading..." : codec.modelsLoaded ? "Downloaded" : "Download Models"}
              </button>
              {confirmClear ? (
                <div className="flex gap-1">
                  <button
                    onClick={handleClear}
                    className="py-2 px-3 rounded-md text-[0.7rem] font-semibold text-[var(--red)] border border-[var(--red)]/40 bg-[var(--red)]/10 cursor-pointer transition-colors hover:bg-[var(--red)]/20"
                  >
                    Yes, delete
                  </button>
                  <button
                    onClick={() => setConfirmClear(false)}
                    className="py-2 px-2 rounded-md text-[0.7rem] text-[var(--overlay)] border border-[var(--surface0)] cursor-pointer hover:text-[var(--text)] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleClear}
                  className="py-2 px-3 rounded-md text-[0.7rem] text-[var(--overlay)] border border-[var(--surface0)] hover:text-[var(--red)] hover:border-[var(--red)]/20 transition-colors cursor-pointer"
                >
                  Delete All
                </button>
              )}
            </div>
          </div>

          <Separator className="bg-[var(--surface0)]" />

          {/* Model Management */}
          <ModelManagement />

          <Separator className="bg-[var(--surface0)]" />

          {/* Theme */}
          <div>
            <label className="text-[0.65rem] uppercase tracking-[0.15em] text-[var(--overlay)] font-semibold">
              Theme
            </label>
            <div className="grid grid-cols-3 gap-1.5 mt-2">
              {themes.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id)}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-md transition-colors cursor-pointer ${
                    theme === t.id
                      ? "bg-[var(--surface0)] border border-[var(--surface1)]"
                      : "hover:bg-[var(--surface0)]/50 border border-transparent"
                  }`}
                >
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0 ring-1 ring-inset ring-white/10"
                    style={{ backgroundColor: t.swatch }}
                  />
                  <span className="text-[0.65rem] text-[var(--subtext)]">{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
