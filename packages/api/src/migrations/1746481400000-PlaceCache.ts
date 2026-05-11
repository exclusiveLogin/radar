import type { MigrationInterface, QueryRunner } from "typeorm";

export class PlaceCache1746481400000 implements MigrationInterface {
  name = "PlaceCache1746481400000";public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE place_cache (
        query_norm text PRIMARY KEY,
        region_id uuid REFERENCES regions(id) ON DELETE SET NULL,
        place_id uuid REFERENCES places(id) ON DELETE SET NULL,
        fias text,
        oktmo text,
        lat numeric(9,6),
        lon numeric(9,6),
        provider text NOT NULL CHECK (provider IN ('dadata', 'nominatim', 'llm')),
        raw jsonb NOT NULL DEFAULT '{}'::jsonb,
        fetched_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_place_cache_provider_fetched ON place_cache(provider, fetched_at DESC);
    `);
  }public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_place_cache_provider_fetched`);
    await queryRunner.query(`DROP TABLE IF EXISTS place_cache`);
  }
}
