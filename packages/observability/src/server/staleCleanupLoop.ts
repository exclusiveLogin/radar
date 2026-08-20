import type { SqlObservabilityStore } from "../store/sqlObservabilityStore.js";

export type StaleCleanupLoopHandle = {
  stop: () => void;
};

/** Чтение stale TTL из env (мс). */
function readStaleMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.RADAR_OBS_STALE_MS?.trim();
  const parsed = raw ? Number(raw) : 120_000;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120_000;
}

/** Чтение интервала cleanup loop (мс). */
function readIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.RADAR_OBS_STALE_INTERVAL_MS?.trim();
  const parsed = raw ? Number(raw) : 30_000;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000;
}

/** Периодическая очистка устаревших obs_* записей. */
export function startStaleCleanupLoop(
  store: SqlObservabilityStore,
  env: NodeJS.ProcessEnv = process.env,
): StaleCleanupLoopHandle {
  const staleMs = readStaleMs(env);
  const intervalMs = readIntervalMs(env);

  const tick = () => {
    const cutoff = new Date(Date.now() - staleMs).toISOString();
    void store.purgeStale(cutoff).catch((err: unknown) => {
      console.warn("[obs-stale] cleanup failed:", err);
    });
  };

  const timer = setInterval(tick, intervalMs);
  tick();

  return {
    stop: () => clearInterval(timer),
  };
}
