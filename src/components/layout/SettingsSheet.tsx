import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ThemeSwitcher } from "@/components/theme/ThemeSwitcher";
import { ModelManagement } from "@/components/codec/ModelManagement";

interface SettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsSheet({ open, onOpenChange }: SettingsSheetProps) {
  const username =
    typeof localStorage !== "undefined"
      ? localStorage.getItem("fc-username") || ""
      : "";

  const handleUsernameChange = (value: string) => {
    localStorage.setItem("fc-username", value);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="bg-[var(--mantle)] border-l border-[var(--surface0)] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-[var(--text)]">Settings</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-4 py-4">
          {/* Username */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="username" className="text-[var(--subtext)] text-xs">
              Username
            </Label>
            <Input
              id="username"
              defaultValue={username}
              placeholder="your name"
              spellCheck={false}
              className="bg-[var(--base)] border-[var(--surface0)] text-[var(--text)] font-mono text-sm"
              onChange={(e) => handleUsernameChange(e.target.value)}
            />
          </div>

          <Separator className="bg-[var(--surface0)]" />

          {/* Model Management */}
          <ModelManagement />

          <Separator className="bg-[var(--surface0)]" />

          {/* Theme */}
          <div className="flex flex-col gap-2">
            <Label className="text-[var(--subtext)] text-xs">Theme</Label>
            <ThemeSwitcher />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
