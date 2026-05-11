import type { IParsedEventRepository, ParsedEvent } from "@radar/shared";
import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import { ParsedEventEntity } from "../../events/entities";

export class TypeOrmParsedEventRepository implements IParsedEventRepository {
  constructor(private readonly dataSource: DataSource) {}async upsert(parsed: ParsedEvent): Promise<{ id: string }> {
    const repo = this.dataSource.getRepository(ParsedEventEntity);
    const existing = await repo.findOne({
      where: {
        rawMessageId: parsed.rawMessageId,
        parserVersion: parsed.parserVersion,
      },
    });
    if (existing) {
      existing.eventType = parsed.eventType;
      existing.severity = parsed.severity;
      existing.repeat = parsed.repeat;
      existing.count = parsed.count ?? null;
      existing.direction = parsed.direction ?? null;
      existing.macroZone = parsed.macroZone ?? null;
      existing.confidence = String(parsed.confidence.toFixed(2));
      existing.extras = parsed.extras as Record<string, unknown>;
      existing.parsedAt = new Date(parsed.postedAt);
      await repo.save(existing);
      return { id: existing.id };
    }

    const row = repo.create({
      id: randomUUID(),
      rawMessageId: parsed.rawMessageId,
      eventType: parsed.eventType,
      severity: parsed.severity,
      repeat: parsed.repeat,
      count: parsed.count ?? null,
      direction: parsed.direction ?? null,
      macroZone: parsed.macroZone ?? null,
      parserVersion: parsed.parserVersion,
      confidence: String(parsed.confidence.toFixed(2)),
      extras: parsed.extras as Record<string, unknown>,
      parsedAt: new Date(parsed.postedAt),
    });
    await repo.save(row);
    return { id: row.id };
  }
}
