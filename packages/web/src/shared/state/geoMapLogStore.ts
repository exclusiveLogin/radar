import { BehaviorSubject } from "rxjs";

export type GeoMapLogLevel = "info" | "warn" | "error";

export type GeoMapLogEntry = {
  id: string;
  level: GeoMapLogLevel;
  message: string;
  at: number;
};

const MAX_ENTRIES = 5;
const TTL_MS = 5_000;

export const geoMapLogEntries$ = new BehaviorSubject<GeoMapLogEntry[]>([]);

const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Лаконичное сообщение в игровой ленте угла карты. */
export function pushGeoMapLog(level: GeoMapLogLevel, message: string): void {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const entry: GeoMapLogEntry = { id, level, message, at: Date.now() };
  geoMapLogEntries$.next([entry, ...geoMapLogEntries$.value].slice(0, MAX_ENTRIES));

  const prevTimer = expiryTimers.get(id);
  if (prevTimer) clearTimeout(prevTimer);
  expiryTimers.set(
    id,
    setTimeout(() => {
      geoMapLogEntries$.next(geoMapLogEntries$.value.filter((row) => row.id !== id));
      expiryTimers.delete(id);
    }, TTL_MS),
  );
}

export function clearGeoMapLogs(): void {
  for (const timer of expiryTimers.values()) clearTimeout(timer);
  expiryTimers.clear();
  geoMapLogEntries$.next([]);
}
