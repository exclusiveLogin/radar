import { BehaviorSubject } from "rxjs";

export type ThemeMode = "dark" | "light";

const STORAGE_KEY = "radar-theme";

function readStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* localStorage недоступен */
  }
  return "dark";
}

/** Текущая тема приложения. */
export const theme$ = new BehaviorSubject<ThemeMode>(readStoredTheme());

/** Применяет тему к DOM и сохраняет в localStorage. */
export function setTheme(mode: ThemeMode): void {
  document.documentElement.setAttribute("data-theme", mode);
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
  theme$.next(mode);
}

/** Переключает dark ↔ light. */
export function toggleTheme(): void {
  setTheme(theme$.value === "dark" ? "light" : "dark");
}

/** Инициализация темы при старте приложения (вызывать до первого рендера). */
export function initTheme(): void {
  setTheme(theme$.value);
}
