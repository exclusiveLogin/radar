import type { IParsedEventRepository, ParsedEvent, ParsedEventRecord } from "@radar/shared";
import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import { ParsedEventEntity } from "../../events/entities";

function toParsedEventRecord(row: ParsedEventEntity): ParsedEventRecord {
  return {
    id: row.id,
    rawMessageId: row.rawMessageId,
    eventType: row.eventType as ParsedEvent["eventType"],
    severity: row.severity as ParsedEvent["severity"],
    repeat: row.repeat,
    count: row.count ?? undefined,
    direction: row.direction ?? undefined,
    macroZone: row.macroZone ?? undefined,
    locations: [],
    postedAt: row.parsedAt.toISOString(),
    parserVersion: row.parserVersion,
    confidence: Number(row.confidence),
    extras: row.extras ?? {},
    isActive: row.isActive,
    inactiveReason: row.inactiveReason ?? undefined,
    eventSubject: (row.eventSubject as ParsedEvent["eventSubject"]) ?? undefined,
  };
}

export class TypeOrmParsedEventRepository implements IParsedEventRepository {
  constructor(private readonly dataSource: DataSource) {}
async upsert(parsed: ParsedEvent): Promise<{ id: string }> {
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
      existing.isActive = parsed.isActive ?? true;
      existing.inactiveReason = parsed.isActive === false ? (parsed.inactiveReason ?? null) : null;
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
      isActive: parsed.isActive ?? true,
      inactiveReason: parsed.isActive === false ? (parsed.inactiveReason ?? null) : null,
      parsedAt: new Date(parsed.postedAt),
    });
    await repo.save(row);
    return { id: row.id };
  }

  async findByRawMessageId(rawMessageId: string): Promise<ParsedEventRecord | null> {
    const repo = this.dataSource.getRepository(ParsedEventEntity);
    const row = await repo.findOne({
      where: { rawMessageId },
      order: { parsedAt: "DESC" },
    });
    return row ? toParsedEventRecord(row) : null;
  }
}
