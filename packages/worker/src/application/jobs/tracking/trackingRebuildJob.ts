/**
 * ---
 * layer: worker/jobs
 * domain: tracking
 * purpose: Scheduled job — инвалидирует derived tracking state и запускает
 *          тот же incremental drain, что и live worker.
 * ---
 */
import type { DataSource } from "typeorm";
import { restartTrackingDrain } from "../../../infrastructure/tracking/trackingPipelineStateRepository.js";

export type TrackingRebuildJobConfig = {
  /** Логгер — любой объект с методами info/error. */
  logger?: { info: (msg: string, ctx?: unknown) => void; error: (msg: string, ctx?: unknown) => void };
};

/**
 * Запускает единый reset/start contract. Обработку выполняет tracking worker.
 */
export async function runTrackingRebuildJob(
  ds: DataSource,
  config: TrackingRebuildJobConfig = {},
): Promise<void> {
  const logger = config.logger ?? console;

  logger.info("[tracking:rebuild] Запуск unified tracking drain");

  try {
    const run = await restartTrackingDrain(ds);
    logger.info("[tracking:rebuild] Drain запущен", { runId: run.id });
  } catch (err) {
    logger.error("[tracking:rebuild] Ошибка rebuild", { err });
    throw err;
  }
}
