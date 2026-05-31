/**
 * Идемпотентное слияние дублей places по (region_id, kind, name_normalized).
 *
 * В отличие от разовой миграции (которая удаляла производные строки и требовала
 * reparse), здесь применяется repoint: все ссылки проигравших переносятся на
 * survivor, и лишь затем пустая строка удаляется. Данные не теряются, повторный
 * прогон при 0 дублях — no-op. Поэтому стадию безопасно встраивать в geo:init/update.
 *
 * Survivor выбирается детерминированно: сначала запись с fias_id, затем самая
 * старая (created_at) — при повторе тот же.
 */

/** Минимальный исполнитель SQL (TypeORM DataSource/EntityManager.query). */
export type SqlRunner = (sql: string, params?: unknown[]) => Promise<unknown[]>;

export type DedupResult = { groups: number; merged: number };

type DuplicateGroup = { survivor: string; losers: string[] };

export class PlaceDedupService {
  /** Находит группы дублей; первый id — survivor (fias_id раньше, затем старейший). */
  private async findDuplicateGroups(sql: SqlRunner): Promise<DuplicateGroup[]> {
    const rows = (await sql(`
      SELECT array_agg(id ORDER BY (fias_id IS NULL), created_at) AS ids
      FROM places
      WHERE is_active
      GROUP BY region_id, kind, name_normalized
      HAVING COUNT(*) > 1
    `)) as Array<{ ids: string[] }>;

    return rows.map(({ ids }) => ({ survivor: ids[0], losers: ids.slice(1) }));
  }

  /** Переносит все ссылки loser → survivor и удаляет пустую строку loser. */
  private async mergeLoserIntoSurvivor(
    sql: SqlRunner,
    survivor: string,
    loser: string,
  ): Promise<void> {
    // Таблицы с уникальностью: сначала убрать конфликтующие строки loser, потом перенести.
    await sql(
      `DELETE FROM place_status_active l
       WHERE l.place_id = $1
         AND EXISTS (
           SELECT 1 FROM place_status_active s
           WHERE s.place_id = $2 AND s.status_code = l.status_code
         )`,
      [loser, survivor],
    );
    await sql(
      `DELETE FROM place_aliases l
       WHERE l.place_id = $1 AND l.is_active
         AND EXISTS (
           SELECT 1 FROM place_aliases s
           WHERE s.place_id = $2 AND s.is_active
             AND s.target_kind = l.target_kind
             AND s.alias_normalized = l.alias_normalized
         )`,
      [loser, survivor],
    );

    // Перенос ссылок (для status_active/aliases остаток уже без конфликтов).
    for (const table of [
      "place_status_active",
      "place_status_history",
      "place_aliases",
      "event_locations",
      "place_evidence",
      "place_cache",
    ]) {
      await sql(`UPDATE ${table} SET place_id = $1 WHERE place_id = $2`, [survivor, loser]);
    }
    await sql(`UPDATE places SET parent_place_id = $1 WHERE parent_place_id = $2`, [survivor, loser]);
    await sql(`DELETE FROM places WHERE id = $1`, [loser]);
  }

  /** Считает дубли без записи (dry-run). */
  async plan(sql: SqlRunner): Promise<DedupResult> {
    const groups = await this.findDuplicateGroups(sql);
    const merged = groups.reduce((acc, g) => acc + g.losers.length, 0);
    return { groups: groups.length, merged };
  }

  /** Сливает дубли. Ожидает транзакционный sql (вызывается внутри transaction). */
  async apply(sql: SqlRunner): Promise<DedupResult> {
    const groups = await this.findDuplicateGroups(sql);
    let merged = 0;
    for (const { survivor, losers } of groups) {
      for (const loser of losers) {
        await this.mergeLoserIntoSurvivor(sql, survivor, loser);
        merged += 1;
      }
    }
    return { groups: groups.length, merged };
  }
}
