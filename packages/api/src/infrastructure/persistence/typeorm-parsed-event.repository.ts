import type {
  IParsedEventRepository,
  IMessageParseWorkspaceRepository,
  MessageParseWorkspaceRecord,
  ParsedEvent,
  ParsedEventRecord,
} from "@radar/shared";
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
    return this.upsertById(undefined, parsed);
  }

  async upsertById(id: string | undefined, parsed: ParsedEvent): Promise<{ id: string }> {
    const repo = this.dataSource.getRepository(ParsedEventEntity);
    // Без id — всегда новый parsed_event (multi-anchor finalize). Обновление — только по id / candidateEventMap.
    const existing = id ? await repo.findOne({ where: { id } }) : null;

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
      existing.inactiveReason =
        parsed.isActive === false ? (parsed.inactiveReason ?? null) : null;
      existing.parsedAt = new Date(parsed.postedAt);
      existing.parserVersion = parsed.parserVersion;
      if (parsed.eventSubject !== undefined) {
        existing.eventSubject = parsed.eventSubject;
      }
      await repo.save(existing);
      return { id: existing.id };
    }

    const row = repo.create({
      id: id ?? randomUUID(),
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
      eventSubject: parsed.eventSubject ?? null,
    });
    await repo.save(row);
    return { id: row.id };
  }

  async findByRawMessageId(rawMessageId: string): Promise<ParsedEventRecord | null> {
    const all = await this.findAllByRawMessageId(rawMessageId);
    return all[0] ?? null;
  }

  async findAllByRawMessageId(rawMessageId: string): Promise<ParsedEventRecord[]> {
    const repo = this.dataSource.getRepository(ParsedEventEntity);
    const rows = await repo.find({
      where: { rawMessageId },
      order: { parsedAt: "DESC" },
    });
    return rows.map(toParsedEventRecord);
  }

  async deactivateById(id: string, inactiveReason?: string): Promise<void> {
    const repo = this.dataSource.getRepository(ParsedEventEntity);
    await repo.update(
      { id },
      {
        isActive: false,
        inactiveReason: inactiveReason ?? "workspace:orphan_sweep",
      },
    );
  }

  async hardDeleteById(id: string): Promise<void> {
    const repo = this.dataSource.getRepository(ParsedEventEntity);
    await repo.delete({ id });
  }
}

type WorkspaceRow = {
  id: string;
  raw_message_id: string;
  parser_revision: string;
  status: MessageParseWorkspaceRecord["status"];
  groomed_text: string;
  workspace: MessageParseWorkspaceRecord["workspace"];
  spawned_event_ids: string[];
  candidate_event_map: Record<string, string>;
  finalized_at: string | null;
  created_at: string;
};

function toWorkspaceRecord(row: WorkspaceRow): MessageParseWorkspaceRecord {
  return {
    id: row.id,
    rawMessageId: row.raw_message_id,
    parserRevision: row.parser_revision,
    status: row.status,
    groomedText: row.groomed_text,
    workspace: row.workspace,
    spawnedEventIds: row.spawned_event_ids ?? [],
    candidateEventMap: row.candidate_event_map ?? {},
    finalizedAt: row.finalized_at ?? undefined,
    createdAt: row.created_at,
  };
}

export class TypeOrmMessageParseWorkspaceRepository implements IMessageParseWorkspaceRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findActiveByRawMessageId(
    rawMessageId: string,
  ): Promise<MessageParseWorkspaceRecord | null> {
    const rows = (await this.dataSource.query(
      `
        SELECT *
        FROM message_parse_workspace
        WHERE raw_message_id = $1 AND status = 'finalized'
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [rawMessageId],
    )) as WorkspaceRow[];
    return rows[0] ? toWorkspaceRecord(rows[0]) : null;
  }

  async supersedeActiveForRaw(rawMessageId: string): Promise<void> {
    await this.dataSource.query(
      `
        UPDATE message_parse_workspace
        SET status = 'superseded'
        WHERE raw_message_id = $1 AND status = 'finalized'
      `,
      [rawMessageId],
    );
  }

  async saveFinalized(input: {
    rawMessageId: string;
    parserRevision: string;
    groomedText: string;
    workspace: MessageParseWorkspaceRecord["workspace"];
    spawnedEventIds: string[];
    candidateEventMap: Record<string, string>;
  }): Promise<MessageParseWorkspaceRecord> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      // Сериализуем concurrent finalize (reparse CLI + ingestParse daemon).
      await queryRunner.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [
        input.rawMessageId,
      ]);
      await queryRunner.query(
        `
          UPDATE message_parse_workspace
          SET status = 'superseded'
          WHERE raw_message_id = $1 AND status = 'finalized'
        `,
        [input.rawMessageId],
      );
      const rows = (await queryRunner.query(
        `
          INSERT INTO message_parse_workspace (
            id, raw_message_id, parser_revision, status, groomed_text, workspace,
            spawned_event_ids, candidate_event_map, finalized_at, created_at
          )
          VALUES ($1, $2, $3, 'finalized', $4, $5::jsonb, $6::uuid[], $7::jsonb, $8, $8)
          RETURNING *
        `,
        [
          id,
          input.rawMessageId,
          input.parserRevision,
          input.groomedText,
          JSON.stringify(input.workspace),
          input.spawnedEventIds,
          JSON.stringify(input.candidateEventMap),
          now,
        ],
      )) as WorkspaceRow[];
      await queryRunner.commitTransaction();
      return toWorkspaceRecord(rows[0]!);
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}
