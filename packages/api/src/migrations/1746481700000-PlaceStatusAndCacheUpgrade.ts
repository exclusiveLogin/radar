import type { MigrationInterface, QueryRunner } from "typeorm";

export class PlaceStatusAndCacheUpgrade1746481700000 implements MigrationInterface {
  name = "PlaceStatusAndCacheUpgrade1746481700000";public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE place_cache
      ADD COLUMN IF NOT EXISTS validated_at timestamptz,
      ADD COLUMN IF NOT EXISTS validator text,
      ADD COLUMN IF NOT EXISTS confidence numeric(4,3),
      ADD COLUMN IF NOT EXISTS expires_at timestamptz;
    `);

    await queryRunner.query(`
      ALTER TABLE place_cache
      DROP CONSTRAINT IF EXISTS place_cache_pkey;
    `);
    await queryRunner.query(`
      ALTER TABLE place_cache
      ADD CONSTRAINT place_cache_pkey PRIMARY KEY (query_norm, provider);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS status_dictionary (
        code text PRIMARY KEY,
        title text NOT NULL,
        include_on_map boolean NOT NULL DEFAULT true,
        parser_hints text[] NOT NULL DEFAULT ARRAY[]::text[],
        is_active boolean NOT NULL DEFAULT true,
        priority integer NOT NULL DEFAULT 100,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_status_dictionary_active_priority
      ON status_dictionary(is_active, priority);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS place_status_active (
        place_id uuid NOT NULL REFERENCES places(id) ON DELETE CASCADE,
        status_code text NOT NULL REFERENCES status_dictionary(code) ON DELETE RESTRICT,
        source text NOT NULL CHECK (source IN ('parser', 'operator', 'system')),
        started_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        meta jsonb NOT NULL DEFAULT '{}'::jsonb,
        PRIMARY KEY (place_id, status_code)
      );
      CREATE INDEX IF NOT EXISTS idx_place_status_active_status
      ON place_status_active(status_code, updated_at DESC);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS place_status_history (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        place_id uuid NOT NULL REFERENCES places(id) ON DELETE CASCADE,
        status_code text NOT NULL REFERENCES status_dictionary(code) ON DELETE RESTRICT,
        action text NOT NULL CHECK (action IN ('activate', 'deactivate')),
        source text NOT NULL CHECK (source IN ('parser', 'operator', 'system')),
        event_at timestamptz NOT NULL,
        meta jsonb NOT NULL DEFAULT '{}'::jsonb
      );
      CREATE INDEX IF NOT EXISTS idx_place_status_history_place_time
      ON place_status_history(place_id, event_at DESC);
      CREATE INDEX IF NOT EXISTS idx_place_status_history_status_time
      ON place_status_history(status_code, event_at DESC);
    `);
  }public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_place_status_history_status_time`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_place_status_history_place_time`);
    await queryRunner.query(`DROP TABLE IF EXISTS place_status_history`);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_place_status_active_status`);
    await queryRunner.query(`DROP TABLE IF EXISTS place_status_active`);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_status_dictionary_active_priority`);
    await queryRunner.query(`DROP TABLE IF EXISTS status_dictionary`);

    await queryRunner.query(`
      ALTER TABLE place_cache
      DROP CONSTRAINT IF EXISTS place_cache_pkey;
    `);
    await queryRunner.query(`
      ALTER TABLE place_cache
      ADD CONSTRAINT place_cache_pkey PRIMARY KEY (query_norm);
    `);
    await queryRunner.query(`
      ALTER TABLE place_cache
      DROP COLUMN IF EXISTS validated_at,
      DROP COLUMN IF EXISTS validator,
      DROP COLUMN IF EXISTS confidence,
      DROP COLUMN IF EXISTS expires_at;
    `);
  }
}
