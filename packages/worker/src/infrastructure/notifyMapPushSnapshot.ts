const TRUTHY = new Set(["1", "true", "yes", "on"]);

/** По умолчанию вкл.: после completed phase_run — полный snapshot по WS. */
export function isMapSnapshotAfterPhaseEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.RADAR_MAP_SNAPSHOT_AFTER_PHASE?.trim().toLowerCase();
  if (!raw) return true;
  return TRUTHY.has(raw);
}

/** После drain-фазы: синхронизировать карту с БД (дельты поллера могли отстать). */
export async function notifyMapPushSnapshotAfterPhase(): Promise<void> {
  if (!isMapSnapshotAfterPhaseEnabled()) return;
  await notifyMapPushSnapshot();
}

/**
 * Просит API разослать map/snapshot по WS (если api:dev запущен).
 */
export async function notifyMapPushSnapshot(): Promise<void> {  const base = (process.env.RADAR_API_URL ?? `http://127.0.0.1:${process.env.PORT ?? "3000"}`).replace(
    /\/$/,
    "",
  );
  try {
    const res = await fetch(`${base}/api/map/push-snapshot`, { method: "POST" });
    if (!res.ok) {
      console.warn(`map/push-snapshot: HTTP ${res.status} — обновите карту (F5)`);
      return;
    }
    const body = (await res.json()) as { pushed?: boolean };
    if (body.pushed) {
      console.log("Карта: snapshot разослан открытым клиентам по WS.");
    } else {
      console.warn("Карта: API без WS-клиентов — обновите страницу (F5).");
    }
  } catch {
    console.warn(`Карта: API недоступен (${base}) — обновите страницу (F5).`);
  }
}
