import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

// A new key for the Nacre redesign: everyone starts on the new light look once (the old key stored
// whatever the old dark default happened to be), then their own choice sticks.
const THEME_KEY = "nemnidhi_theme";

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage unavailable (private browsing, etc.) - use the default.
  }
  return "light";
}

// theme.css's :root holds the light (Nacre) palette; a "dark" class on <html> switches to the night
// palette and turns on every `dark:` utility. "light" is kept alongside for any older selectors.
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Theme just won't persist across reloads.
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  return { theme, toggleTheme };
}
