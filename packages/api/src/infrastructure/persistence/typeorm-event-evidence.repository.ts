import type {
  EventEvidenceRecord,
  IEventEvidenceRepository,
} from "@radar/shared";
import type { DataSource } from "typeorm";

function toBucket15m(observedAtIso: string): Date {
  const date = new Date(observedAtIso);
  const ms = date.getTime();
  const bucket = Math.floor(ms / (15 * 60 * 1000)) * (15 * 60 * 1000);
  return new Date(bucket);
}

export class TypeOrmEventEvidenceRepository
implements IEventEvidenceRepository {
  constructor(private readonly dataSource: DataSource) {}

  async append(record: EventEvidenceRecord): Promise<void> {
    const bucket = record.timeBucket15m
      ? new Date(record.timeBucket15m)
      : toBucket15m(record.observedAt);
    await this.dataSource.query(
      `
      INSERT INTO event_evidence(
        id, event_id, event_type, place_id, observed_at, time_bucket_15m,
        provider_kind, source_provider_id, source_channel_key, source_message_id,
        trace_id, payload, trust_score, created_at
      )
      VALUES ($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7,$8,$9,$10,$11,$12::jsonb,$13,now())
      ON CONFLICT (event_type, place_id, time_bucket_15m) DO NOTHING
      `,
      [
        record.id,
        record.eventId,
        record.eventType,
        record.placeId,
        record.observedAt,
        bucket.toISOString(),
        record.providerKind,
        record.sourceProviderId ?? null,
        record.sourceChannelKey ?? null,
        record.sourceMessageId ?? null,
        record.traceId ?? null,
        JSON.stringify(record.payload ?? {}),
        record.trustScore ?? null,
      ],
    );
  }
}
