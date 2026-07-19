import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "mat_parse_evidence" })
export class EventEvidenceEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "event_id", type: "uuid" })
  eventId!: string;

  @Column({ name: "event_type", type: "text" })
  eventType!: string;

  @Column({ name: "place_id", type: "uuid" })
  placeId!: string;

  @Column({ name: "observed_at", type: "timestamptz" })
  observedAt!: Date;

  @Column({ name: "time_bucket_15m", type: "timestamptz" })
  timeBucket15m!: Date;

  @Column({ name: "provider_kind", type: "text" })
  providerKind!: string;

  @Column({ name: "source_provider_id", type: "text", nullable: true })
  sourceProviderId!: string | null;

  @Column({ name: "source_channel_key", type: "text", nullable: true })
  sourceChannelKey!: string | null;

  @Column({ name: "source_message_id", type: "text", nullable: true })
  sourceMessageId!: string | null;

  @Column({ name: "trace_id", type: "text", nullable: true })
  traceId!: string | null;

  @Column({ name: "payload", type: "jsonb", default: () => "'{}'::jsonb" })
  payload!: Record<string, unknown>;

  @Column({ name: "trust_score", type: "numeric", precision: 4, scale: 3, nullable: true })
  trustScore!: string | null;

  @Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
  createdAt!: Date;
}
