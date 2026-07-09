import type { DataSource } from "typeorm";
import type { WipeLogger } from "./wipeLog.js";
import { countTableRows, truncateTableCounted } from "./wipeTableSql.js";

export type ClearRawArchiveResult = {
  rawMessagesDeleted: number;
};

export class ClearRawArchiveBlockedError extends Error {
  constructor(
    public readonly parsedEventsCount: number,
    public readonly parseAttemptsCount: number,
  ) {
    super(
      `Нельзя удалить raw: остались mat_parse_event=${parsedEventsCount}, log_parse_attempt=${parseAttemptsCount}. ` +
        `Сначала: npm run parse-engine:reset`,
    );
    this.name = "ClearRawArchiveBlockedError";
  }
}

/** Сколько строк мешают удалению raw (FK RESTRICT на mat_parse_event). */
export async function countRawArchiveBlockers(dataSource: DataSource): Promise<{
  parsedEvents: number;
  parseAttempts: number;
  rawMessages: number;
}> {
  return {
    parsedEvents: await countTableRows(dataSource, "mat_parse_event"),
    parseAttempts: await countTableRows(dataSource, "log_parse_attempt"),
    rawMessages: await countTableRows(dataSource, "mat_ingest_raw"),
  };
}

/**
 * TRUNCATE mat_ingest_raw (+ mat_ingest_raw_tg, queue_parse_coverage CASCADE).
 */
export async function clearRawArchive(
  dataSource: DataSource,
  options: { force?: boolean; log?: WipeLogger } = {},
): Promise<ClearRawArchiveResult> {
  const { log } = options;
  const blockers = await countRawArchiveBlockers(dataSource);
  log?.detail(
    `raw blockers: mat_parse_event=${blockers.parsedEvents}, log_parse_attempt=${blockers.parseAttempts}, mat_ingest_raw=${blockers.rawMessages}`,
  );

  if (!options.force && (blockers.parsedEvents > 0 || blockers.parseAttempts > 0)) {
    throw new ClearRawArchiveBlockedError(blockers.parsedEvents, blockers.parseAttempts);
  }

  const rawMessagesDeleted = await truncateTableCounted(dataSource, "mat_ingest_raw", {
    cascade: true,
    log,
  });

  return { rawMessagesDeleted };
}
