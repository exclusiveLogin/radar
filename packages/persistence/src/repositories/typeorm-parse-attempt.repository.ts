import type { IParseAttemptRepository, ParseAttemptInput } from "@radar/shared";
import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import { ParseAttemptEntity } from "../entities/events";

/**
 * Технический след парсинга: INSERT в log_parse_attempt для каждого результата
 * (ok / skipped / failed). Источник для лога парсинга и агрегатов по каналу.
 */
export class TypeOrmParseAttemptRepository implements IParseAttemptRepository {
  constructor(private readonly dataSource: DataSource) {}

  async append(input: ParseAttemptInput): Promise<void> {
    const repo = this.dataSource.getRepository(ParseAttemptEntity);
    const row = repo.create({
      id: randomUUID(),
      rawMessageId: input.rawMessageId,
      channelKey: input.channelKey,
      parserVersion: input.parserVersion,
      status: input.status,
      errors: input.errors ?? null,
    });
    await repo.save(row);
  }
}
