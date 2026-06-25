/**
 * ---
 * layer: worker/jobs
 * domain: tracking
 * purpose: Scheduled job — запускает rebuild треков каждые N минут.
 *          V1: полный rebuild за последние 24ч (идемпотентен).
 * ---
 */
import type { DataSource } from "typeorm";
import { runTrackingRebuild } from "../../tracking/trackingRebuildService.js";

/** Период окна rebuild (по умолчанию 24 ч). */
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

export type TrackingRebuildJobConfig = {
  /** Окно исторических данных для rebuild (мс). По умолчанию 24ч. */
  windowMs?: number;
  /** Логгер — любой объект с методами info/error. */
  logger?: { info: (msg: string, ctx?: unknown) => void; error: (msg: string, ctx?: unknown) => void };
};

/**
 * Запускает rebuild треков за скользящее окно [now-windowMs, now].
 * Предназначен для запуска по расписанию (cron/setInterval).
 */
export async function runTrackingRebuildJob(
  ds: DataSource,
  config: TrackingRebuildJobConfig = {},
): Promise<void> {
  const windowMs = config.windowMs ?? DEFAULT_WINDOW_MS;
  const logger = config.logger ?? console;
  const until = new Date();
  const since = new Date(until.getTime() - windowMs);

  logger.info("[tracking:rebuild] Запуск rebuild треков", { since, until });

  try {
    const result = await runTrackingRebuild(ds, { since, until });
    logger.info("[tracking:rebuild] Готово", result);
  } catch (err) {
    logger.error("[tracking:rebuild] Ошибка rebuild", { err });
    throw err;
  }
}
