import { useObservable } from "../hooks/useObservable";
import { theme$, toggleTheme } from "../state/themeStore";

/** Переключатель тёмной/светлой темы. */
export function ThemeToggle() {
  const theme = useObservable(theme$, "dark");

  return (
    <button
      type="button"
      className="ds-theme-toggle"
      onClick={toggleTheme}
      title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
      aria-label="Переключить тему"
    >
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
