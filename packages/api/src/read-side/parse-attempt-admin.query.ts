import { parseAttemptItemSchema, type ParseAttemptItem } from "@radar/shared";
import type { DataSource } from "typeorm";

const MESSAGE_PREVIEW_LEN = 160;

type ParseAttemptSqlRow = {
  id: string;
  raw_message_id: string;
  channel_key: string | null;
  parser_version: string;
  status: "ok" | "failed" | "skipped";
  errors: Record<string, unknown> | null;
  created_at: Date;
  message_preview: string | null;
  external_message_id: string | null;
  event_type: string | null;
};

function resolveOutcomeLabel(row: ParseAttemptSqlRow): string | null {
  if (row.event_type) return row.event_type;
  const reason = row.errors?.reason;
  return typeof reason === "string" ? reason : null;
}

/** Строка log_parse_attempt + превью raw и тип события для админ-лога. */
export function mapParseAttemptAdminRow(row: ParseAttemptSqlRow): ParseAttemptItem {
  return parseAttemptItemSchema.parse({
    id: row.id,
    rawMessageId: row.raw_message_id,
    channelKey: row.channel_key,
    parserVersion: row.parser_version,
    status: row.status,
    errors: row.errors,
    createdAt: row.created_at.toISOString(),
    messagePreview: row.message_preview?.trim() || null,
    externalMessageId: row.external_message_id,
    outcomeLabel: resolveOutcomeLabel(row),
  });
}

const SELECT_PARSE_ATTEMPT_ADMIN = `
  SELECT
    pa.id,
    pa.raw_message_id,
    pa.channel_key,
    pa.parser_version,
    pa.status,
    pa.errors,
    pa.created_at,
    left(rm.raw_text, ${MESSAGE_PREVIEW_LEN}) AS message_preview,
    rm.external_message_id,
    pe.event_type
  FROM log_parse_attempt pa
  LEFT JOIN mat_ingest_raw rm ON rm.id = pa.raw_message_id
  LEFT JOIN LATERAL (
    SELECT event_type
    FROM mat_parse_event
    WHERE raw_message_id = pa.raw_message_id
    ORDER BY parsed_at DESC NULLS LAST
    LIMIT 1
  ) pe ON true
`;

/** Последние попытки парсинга для REST-ленты. */
export async function listParseAttemptsForAdmin(
  dataSource: DataSource,
  params: { limit: number; status?: string; channelKey?: string },
): Promise<ParseAttemptItem[]> {
  const clauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (params.status) {
    clauses.push(`pa.status = $${idx++}`);
    values.push(params.status);
  }
  if (params.channelKey) {
    clauses.push(`pa.channel_key = $${idx++}`);
    values.push(params.channelKey);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  values.push(params.limit);

  const rows = await dataSource.query<ParseAttemptSqlRow[]>(
    `${SELECT_PARSE_ATTEMPT_ADMIN}
     ${where}
     ORDER BY pa.created_at DESC
     LIMIT $${idx}`,
    values,
  );

  return rows.map(mapParseAttemptAdminRow);
}

/** Новые строки после курсора (admin WS poll). */
export async function listParseAttemptsSince(
  dataSource: DataSource,
  since: Date,
  limit: number,
): Promise<ParseAttemptItem[]> {
  const rows = await dataSource.query<ParseAttemptSqlRow[]>(
    `${SELECT_PARSE_ATTEMPT_ADMIN}
     WHERE pa.created_at > $1
     ORDER BY pa.created_at ASC
     LIMIT $2`,
    [since, limit],
  );

  return rows.map(mapParseAttemptAdminRow);
}
