import type { DataSource } from "typeorm";
import type { IRegionAdjacencyRepository } from "@radar/shared";

const ADJACENCY_CACHE_MS = 5 * 60 * 1000;

/**
 * Смежность регионов из таблицы `region_adjacency` (наполняется шагом 4/4
 * geo-catalog import из adjacency.json).
 *
 * Граф статичен между импортами, поэтому держим его в памяти; TTL позволяет
 * подхватить переимпорт без рестарта процесса.
 */
export class TypeOrmRegionAdjacencyRepository implements IRegionAdjacencyRepository {
  private cache: { expiresAt: number; value: Promise<Record<string, string[]>> } | undefined;

  constructor(private readonly dataSource: DataSource) {}

  async load(): Promise<Record<string, string[]>> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.value;
    }

    const value = this.query();
    this.cache = { expiresAt: now + ADJACENCY_CACHE_MS, value };
    void value.catch(() => {
      if (this.cache?.value === value) this.cache = undefined;
    });
    return value;
  }

  private async query(): Promise<Record<string, string[]>> {
    const rows = (await this.dataSource.query(
      `SELECT r.iso AS region_code,
              n.iso AS neighbor_code
       FROM region_adjacency a
       INNER JOIN regions r ON r.id = a.region_id AND r.is_active
       INNER JOIN regions n ON n.id = a.neighbor_region_id AND n.is_active
       WHERE r.iso IS NOT NULL AND n.iso IS NOT NULL`,
    )) as Array<{ region_code: string; neighbor_code: string }>;

    const adjacency: Record<string, string[]> = {};
    for (const row of rows) {
      (adjacency[row.region_code] ??= []).push(row.neighbor_code);
    }
    return adjacency;
  }
}
