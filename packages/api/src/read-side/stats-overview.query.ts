import type { DataSource } from "typeorm";

export type PhaseCoverageStatsRow = {
  phaseId: string;
  pending: number;
  processing: number;
  done: number;
  failed: number;
  doneForParsed: number;
};

/**
 * Агрегаты phase_coverage: два лёгких прохода вместо GROUP BY + correlated EXISTS.
 * Использует idx_phase_coverage_phase_status_created.
 */
export async function loadPhaseCoverageStats(
  dataSource: DataSource,
): Promise<PhaseCoverageStatsRow[]> {
  const statusRows = await dataSource.query<
    Array<{ phase_id: string; status: string; count: string }>
  >(
    `SELECT phase_id, status, COUNT(*)::int AS count
     FROM phase_coverage
     GROUP BY phase_id, status
     ORDER BY phase_id, status`,
  );

  const doneParsedRows = await dataSource.query<
    Array<{ phase_id: string; done_for_parsed: string }>
  >(
    `SELECT pc.phase_id, COUNT(DISTINCT pc.raw_message_id)::int AS done_for_parsed
     FROM phase_coverage pc
     INNER JOIN parsed_events pe
       ON pe.raw_message_id = pc.raw_message_id AND pe.is_active = true
     WHERE pc.status = 'done'
     GROUP BY pc.phase_id`,
  );

  const doneParsedByPhase = new Map(
    doneParsedRows.map((row) => [row.phase_id, Number(row.done_for_parsed ?? 0)]),
  );

  const byPhase = new Map<string, PhaseCoverageStatsRow>();

  for (const row of statusRows) {
    const bucket =
      byPhase.get(row.phase_id) ??
      ({
        phaseId: row.phase_id,
        pending: 0,
        processing: 0,
        done: 0,
        failed: 0,
        doneForParsed: doneParsedByPhase.get(row.phase_id) ?? 0,
      } satisfies PhaseCoverageStatsRow);

    if (row.status === "pending") bucket.pending = Number(row.count);
    else if (row.status === "processing") bucket.processing = Number(row.count);
    else if (row.status === "done") bucket.done = Number(row.count);
    else if (row.status === "failed") bucket.failed = Number(row.count);

    byPhase.set(row.phase_id, bucket);
  }

  for (const [phaseId, doneForParsed] of doneParsedByPhase) {
    if (!byPhase.has(phaseId)) {
      byPhase.set(phaseId, {
        phaseId,
        pending: 0,
        processing: 0,
        done: 0,
        failed: 0,
        doneForParsed,
      });
    }
  }

  return [...byPhase.values()].sort((a, b) => a.phaseId.localeCompare(b.phaseId));
}
