import type { DataSource } from "typeorm";

export type ClearRawArchiveResult = {
  rawMessagesDeleted: number;
};

export class ClearRawArchiveBlockedError extends Error {
  constructor(
    public readonly parsedEventsCount: number,
    public readonly parseAttemptsCount: number,
  ) {
    super(
      `Нельзя удалить raw: остались parsed_events=${parsedEventsCount}, parse_attempts=${parseAttemptsCount}. ` +
        `Сначала: npm run clear:pipeline`,
    );
    this.name = "ClearRawArchiveBlockedError";
  }
}

/** Сколько строк мешают удалению raw (FK RESTRICT на parsed_events). */
export async function countRawArchiveBlockers(dataSource: DataSource): Promise<{
  parsedEvents: number;
  parseAttempts: number;
  rawMessages: number;
}> {
  const [parsedRow, attemptsRow, rawRow] = (await Promise.all([
    dataSource.query(`SELECT COUNT(*)::int AS count FROM parsed_events`),
    dataSource.query(`SELECT COUNT(*)::int AS count FROM parse_attempts`),
    dataSource.query(`SELECT COUNT(*)::int AS count FROM raw_messages`),
  ])) as [
    Array<{ count: number }>,
    Array<{ count: number }>,
    Array<{ count: number }>,
  ];

  return {
    parsedEvents: parsedRow[0]?.count ?? 0,
    parseAttempts: attemptsRow[0]?.count ?? 0,
    rawMessages: rawRow[0]?.count ?? 0,
  };
}

/**
 * Удаляет архив raw_messages (+ raw_message_telegram, phase_coverage CASCADE).
 * Требует пустых parsed_events / parse_attempts, если не передан force.
 */
export async function clearRawArchive(
  dataSource: DataSource,
  options: { force?: boolean } = {},
): Promise<ClearRawArchiveResult> {
  const blockers = await countRawArchiveBlockers(dataSource);
  if (!options.force && (blockers.parsedEvents > 0 || blockers.parseAttempts > 0)) {
    throw new ClearRawArchiveBlockedError(blockers.parsedEvents, blockers.parseAttempts);
  }

  const deleted = (await dataSource.query(
    `DELETE FROM raw_messages RETURNING id`,
  )) as Array<{ id: string }>;

  return { rawMessagesDeleted: deleted.length };
}
