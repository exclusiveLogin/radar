import type { IPipelineStabilityRepository } from "@radar/shared";
import type { DataSource } from "typeorm";

/**
 * Atomic busy→stabilized через UPDATE … WHERE status='busy' RETURNING.
 * Несколько реплик могут вызвать tryClaimStabilized одновременно — победит одна.
 * Без prior markBusy claim не срабатывает (нет строки / status≠busy).
 */
export class TypeOrmPipelineStabilityRepository implements IPipelineStabilityRepository {
  constructor(private readonly dataSource: DataSource) {}

  async markBusy(scopeKey: string): Promise<void> {
    await this.dataSource.query(
      `
      INSERT INTO state_pipeline_stability (scope_key, status, generation, updated_at)
      VALUES ($1, 'busy', 0, now())
      ON CONFLICT (scope_key) DO UPDATE
        SET status = 'busy',
            updated_at = now()
      `,
      [scopeKey],
    );
  }

  async tryClaimStabilized(scopeKey: string): Promise<boolean> {
    const rows: Array<{ scope_key: string }> = await this.dataSource.query(
      `
      UPDATE state_pipeline_stability
         SET status = 'stabilized',
             generation = generation + 1,
             updated_at = now()
       WHERE scope_key = $1
         AND status = 'busy'
   RETURNING scope_key
      `,
      [scopeKey],
    );
    return rows.length > 0;
  }
}

/** Адаптер repo → StabilityStore runner-platform. */
export function toStabilityStore(
  repo: IPipelineStabilityRepository,
): {
  markBusy: (scopeKey: string) => Promise<void>;
  tryClaimStabilized: (scopeKey: string) => Promise<boolean>;
} {
  return {
    markBusy: (scopeKey) => repo.markBusy(scopeKey),
    tryClaimStabilized: (scopeKey) => repo.tryClaimStabilized(scopeKey),
  };
}
