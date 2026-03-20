import { useCodecContext } from "@/contexts/CodecContext";
import { useRoom } from "@/contexts/RoomContext";
import { useThemeContext } from "@/contexts/ThemeContext";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface SettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsSheet({ open, onOpenChange }: SettingsSheetProps) {
  const { username, setUsername } = useRoom();
  const codec = useCodecContext();
  const { theme, setTheme, themes } = useThemeContext();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-[var(--base)] border-[var(--surface0)] text-[var(--text)]"
      >
        <SheetHeader>
          <SheetTitle className="text-[var(--text)]">Settings</SheetTitle>
          <SheetDescription className="text-[var(--subtext)]">
            Configure your username, codec, and theme.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 px-4 py-2">
          {/* Username */}
          <div className="flex flex-col gap-2">
            <Label
              htmlFor="settings-username"
              className="text-[0.7rem] text-[var(--overlay)] uppercase tracking-widest font-semibold"
            >
              Username
            </Label>
            <Input
              id="settings-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="your name"
              spellCheck={false}
              className="font-mono bg-[var(--mantle)] border-[var(--surface0)] text-[var(--text)] focus-visible:border-[var(--surface1)] focus-visible:ring-[var(--tv-accent)]/30"
            />
          </div>

          <Separator className="bg-[var(--surface0)]" />

          {/* Codec */}
          <div className="flex flex-col gap-3">
            <Label className="text-[0.7rem] text-[var(--overlay)] uppercase tracking-widest font-semibold">
              Codec
            </Label>

            <div className="flex items-center gap-2 text-[0.75rem] text-[var(--subtext)]">
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  codec.state === "idle"
                    ? "bg-[var(--surface2)]"
                    : codec.state === "loading"
                      ? "bg-[var(--yellow)] animate-pulse"
                      : codec.state === "ready"
                        ? "bg-[var(--green)]"
                        : "bg-[var(--red)]"
                }`}
              />
              <span className="truncate">{codec.statusText}</span>
            </div>

            {codec.state === "loading" && (
              <Progress
                value={codec.progress}
                className="h-1.5 bg-[var(--surface0)]"
              />
            )}

            <Button
              variant="secondary"
              size="sm"
              onClick={codec.loadModels}
              disabled={codec.modelsLoaded || codec.state === "loading"}
              className="w-full bg-[var(--surface0)] text-[var(--subtext)] hover:bg-[var(--surface1)] hover:text-[var(--text)] border-0"
            >
              {codec.modelsLoaded ? "Loaded (50hz)" : "Load Models"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={codec.clearModelCache}
              className="w-full text-[var(--overlay)] opacity-60 hover:opacity-100 hover:text-[var(--text)]"
            >
              Clear Cache
            </Button>
          </div>

          <Separator className="bg-[var(--surface0)]" />

          {/* Theme */}
          <div className="flex flex-col gap-3">
            <Label className="text-[0.7rem] text-[var(--overlay)] uppercase tracking-widest font-semibold">
              Theme
            </Label>
            <div className="grid grid-cols-3 gap-2">
              {themes.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all cursor-pointer ${
                    theme === t.id
                      ? "border-[var(--tv-accent)] bg-[color-mix(in_srgb,var(--tv-accent)_8%,var(--mantle))]"
                      : "border-[var(--surface0)] bg-[var(--mantle)] hover:border-[var(--surface1)]"
                  }`}
                >
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{
                      background: t.swatch,
                      ...(t.id === "midnight"
                        ? {
                            boxShadow:
                              "inset 0 0 0 0.5px rgba(255,255,255,0.1)",
                          }
                        : {}),
                    }}
                  />
                  <span className="text-[0.7rem] text-[var(--subtext)]">
                    {t.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
