import { ThemeProvider } from "@/contexts/ThemeContext";
import { ThemeSwitcher } from "@/components/theme/ThemeSwitcher";

export default function App() {
  return (
    <ThemeProvider>
      <div className="min-h-screen bg-[var(--base)] text-[var(--text)]">
        <header className="flex items-center gap-3 px-5 h-11 bg-[var(--mantle)] border-b border-[var(--surface0)]">
          <h1 className="text-sm font-bold">TinyVoice</h1>
          <span className="text-[0.55rem] px-2 py-0.5 bg-[var(--surface0)] text-[var(--overlay)] rounded-xl font-semibold tracking-wide">
            PTT
          </span>
          <div className="flex-1" />
          <ThemeSwitcher />
        </header>
      </div>
    </ThemeProvider>
  );
}
