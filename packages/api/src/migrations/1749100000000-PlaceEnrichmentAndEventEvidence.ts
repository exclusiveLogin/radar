import type { MigrationInterface, QueryRunner } from "typeorm";

export class PlaceEnrichmentAndEventEvidence1749100000000
implements MigrationInterface {
  name = "PlaceEnrichmentAndEventEvidence1749100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS place_enrichment_jobs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        place_id uuid NOT NULL REFERENCES places(id) ON DELETE CASCADE,
        provider text NOT NULL CHECK (provider IN ('dadata','llm','nominatim')),
        status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed')),
        attempts int NOT NULL DEFAULT 0,
        last_error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_place_enrichment_jobs_place_provider UNIQUE(place_id, provider)
      );
      CREATE INDEX IF NOT EXISTS idx_place_enrichment_jobs_provider_status
        ON place_enrichment_jobs(provider, status, updated_at);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS event_evidence (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id uuid NOT NULL REFERENCES parsed_events(id) ON DELETE CASCADE,
        event_type text NOT NULL,
        place_id uuid NOT NULL REFERENCES places(id) ON DELETE CASCADE,
        observed_at timestamptz NOT NULL,
        time_bucket_15m timestamptz NOT NULL,
        provider_kind text NOT NULL,
        source_provider_id text,
        source_channel_key text,
        source_message_id text,
        trace_id text,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        trust_score numeric(4,3),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_event_evidence_dedup UNIQUE(event_type, place_id, time_bucket_15m)
      );
      CREATE INDEX IF NOT EXISTS idx_event_evidence_event_id
        ON event_evidence(event_id);
      CREATE INDEX IF NOT EXISTS idx_event_evidence_place_observed
        ON event_evidence(place_id, observed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_event_evidence_provider_msg
        ON event_evidence(provider_kind, source_channel_key, source_message_id);
    `);

    await queryRunner.query(`
      ALTER TABLE places DROP CONSTRAINT IF EXISTS places_kind_check;
      ALTER TABLE places
      ADD CONSTRAINT places_kind_check CHECK (kind IN ('region','district','city','locality','settlement','urban_okrug','mo_go'));
    `);

    await queryRunner.query(`DROP TABLE IF EXISTS place_cache`);
    await queryRunner.query(`DROP TABLE IF EXISTS place_evidence`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS event_evidence`);
    await queryRunner.query(`DROP TABLE IF EXISTS place_enrichment_jobs`);
    await queryRunner.query(`
      ALTER TABLE places DROP CONSTRAINT IF EXISTS places_kind_check;
      ALTER TABLE places
      ADD CONSTRAINT places_kind_check CHECK (kind IN ('district','city','locality','settlement','urban_okrug','mo_go'));
    `);
  }
}
