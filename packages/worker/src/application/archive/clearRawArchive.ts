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
      `Нельзя удалить raw: остались parsed_events=${parsedEventsCount}, parse_attempts=${parseAttemptsCount}. ` +
        `Сначала: npm run parse-engine:reset`,
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
  return {
    parsedEvents: await countTableRows(dataSource, "parsed_events"),
    parseAttempts: await countTableRows(dataSource, "parse_attempts"),
    rawMessages: await countTableRows(dataSource, "raw_messages"),
  };
}

/**
 * TRUNCATE raw_messages (+ raw_message_telegram, phase_coverage CASCADE).
 */
export async function clearRawArchive(
  dataSource: DataSource,
  options: { force?: boolean; log?: WipeLogger } = {},
): Promise<ClearRawArchiveResult> {
  const { log } = options;
  const blockers = await countRawArchiveBlockers(dataSource);
  log?.detail(
    `raw blockers: parsed_events=${blockers.parsedEvents}, parse_attempts=${blockers.parseAttempts}, raw_messages=${blockers.rawMessages}`,
  );

  if (!options.force && (blockers.parsedEvents > 0 || blockers.parseAttempts > 0)) {
    throw new ClearRawArchiveBlockedError(blockers.parsedEvents, blockers.parseAttempts);
  }

  const rawMessagesDeleted = await truncateTableCounted(dataSource, "raw_messages", {
    cascade: true,
    log,
  });

  return { rawMessagesDeleted };
}
