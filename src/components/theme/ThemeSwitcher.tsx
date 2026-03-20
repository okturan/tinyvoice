import { useThemeContext } from "@/contexts/ThemeContext";

export function ThemeSwitcher() {
  const { theme, setTheme, themes } = useThemeContext();

  return (
    <div className="flex items-center gap-1">
      {themes.map((t) => (
        <button
          key={t.id}
          title={t.label}
          onClick={() => setTheme(t.id)}
          className="size-3 rounded-full border-2 ring-1 ring-inset ring-white/10 transition-[border-color] duration-150 hover:scale-115 cursor-pointer"
          style={{
            backgroundColor: t.swatch,
            borderColor: theme === t.id ? "var(--text)" : "transparent",
          }}
        />
      ))}
    </div>
  );
}
