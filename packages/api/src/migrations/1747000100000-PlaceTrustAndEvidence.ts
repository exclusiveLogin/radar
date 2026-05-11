import type { MigrationInterface, QueryRunner } from "typeorm";

export class PlaceTrustAndEvidence1747000100000 implements MigrationInterface {
  name = "PlaceTrustAndEvidence1747000100000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE places
      ADD COLUMN IF NOT EXISTS trust_state text NOT NULL DEFAULT 'unverified',
      ADD COLUMN IF NOT EXISTS is_trusted boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS trust_score numeric(4,3),
      ADD COLUMN IF NOT EXISTS trust_updated_at timestamptz,
      ADD COLUMN IF NOT EXISTS evidence_providers jsonb NOT NULL DEFAULT '[]'::jsonb;
    `);

    await queryRunner.query(`
      ALTER TABLE places
      DROP CONSTRAINT IF EXISTS chk_places_trust_state;
    `);
    await queryRunner.query(`
      ALTER TABLE places
      ADD CONSTRAINT chk_places_trust_state
      CHECK (trust_state IN ('unverified', 'partially_verified', 'verified', 'rejected'));
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS place_evidence (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        place_id uuid NOT NULL REFERENCES places(id) ON DELETE CASCADE,
        provider text NOT NULL CHECK (provider IN ('catalog', 'dadata', 'nominatim', 'llm', 'operator', 'system')),
        action text NOT NULL CHECK (action IN ('candidate', 'confirm', 'reject', 'enrich')),
        confidence numeric(4,3),
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        trace_id text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_place_evidence_place_time
      ON place_evidence(place_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_place_evidence_provider_time
      ON place_evidence(provider, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_place_evidence_action
      ON place_evidence(action);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_place_evidence_action`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_place_evidence_provider_time`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_place_evidence_place_time`);
    await queryRunner.query(`DROP TABLE IF EXISTS place_evidence`);

    await queryRunner.query(`
      ALTER TABLE places
      DROP CONSTRAINT IF EXISTS chk_places_trust_state;
    `);
    await queryRunner.query(`
      ALTER TABLE places
      DROP COLUMN IF EXISTS evidence_providers,
      DROP COLUMN IF EXISTS trust_updated_at,
      DROP COLUMN IF EXISTS trust_score,
      DROP COLUMN IF EXISTS is_trusted,
      DROP COLUMN IF EXISTS trust_state;
    `);
  }
}
