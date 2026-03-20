import { useState, useEffect, useCallback } from "react";

export const THEME_STORAGE_KEY = "fc-theme";
export const DEFAULT_THEME = "mocha";

export const THEMES = [
  { id: "mocha", label: "Mocha", swatch: "#89b4fa" },
  { id: "nord", label: "Nord", swatch: "#5e81ac" },
  { id: "rosepine", label: "Rose Pine", swatch: "#c4a7e7" },
  { id: "solarized", label: "Solarized", swatch: "#2aa198" },
  { id: "midnight", label: "Midnight", swatch: "#1c1c26" },
  { id: "latte", label: "Latte", swatch: "#dd7878" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

function getStoredTheme(): ThemeId {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored && THEMES.some((t) => t.id === stored)) {
    return stored as ThemeId;
  }
  return DEFAULT_THEME;
}

function applyTheme(id: ThemeId) {
  document.documentElement.setAttribute("data-theme", id);
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>(getStoredTheme);

  // Apply theme to DOM on mount and when it changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((id: ThemeId) => {
    localStorage.setItem(THEME_STORAGE_KEY, id);
    setThemeState(id);
  }, []);

  return { theme, setTheme, themes: THEMES };
}
