import type { MigrationInterface, QueryRunner } from "typeorm";

export class GeoRegionsPlaces1746481000000 implements MigrationInterface {
  name = "GeoRegionsPlaces1746481000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE regions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        fias_id text UNIQUE,
        kladr_id text,
        iso text,
        name text NOT NULL,
        name_with_type text,
        short_name text,
        federal_district text,
        front_region boolean NOT NULL DEFAULT false,
        border_region boolean NOT NULL DEFAULT false,
        centroid_lat numeric(9,6),
        centroid_lon numeric(9,6),
        bbox jsonb,
        geometry_artifact_key text REFERENCES geo_dataset_file(artifact_key) ON DELETE RESTRICT,
        source_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
        is_active boolean NOT NULL DEFAULT true,
        deprecated_at timestamptz,
        last_synced_at timestamptz,
        last_source_revision text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_regions_name ON regions(name);
      CREATE INDEX idx_regions_is_active ON regions(is_active);
      CREATE INDEX idx_regions_fias ON regions(fias_id);
    `);

    await queryRunner.query(`
      CREATE TABLE places (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        region_id uuid NOT NULL REFERENCES regions(id) ON DELETE RESTRICT,
        parent_place_id uuid REFERENCES places(id) ON DELETE RESTRICT,
        kind text NOT NULL CHECK (kind IN ('district', 'city', 'locality', 'settlement', 'urban_okrug', 'mo_go')),
        name text NOT NULL,
        name_with_type text,
        name_normalized text NOT NULL DEFAULT '',
        fias_id text UNIQUE,
        kladr_id text,
        oktmo text,
        centroid_lat numeric(9,6),
        centroid_lon numeric(9,6),
        bbox jsonb,
        geometry_artifact_key text REFERENCES geo_dataset_file(artifact_key) ON DELETE RESTRICT,
        is_active boolean NOT NULL DEFAULT true,
        deprecated_at timestamptz,
        last_synced_at timestamptz,
        last_source_revision text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_places_region_kind_name ON places(region_id, kind, name_normalized);
      CREATE INDEX idx_places_is_active ON places(is_active);
      CREATE INDEX idx_places_fias ON places(fias_id);
    `);

    await queryRunner.query(`
      CREATE TABLE place_aliases (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        target_kind text NOT NULL CHECK (target_kind IN ('region', 'place')),
        region_id uuid REFERENCES regions(id) ON DELETE RESTRICT,
        place_id uuid REFERENCES places(id) ON DELETE RESTRICT,
        alias text NOT NULL,
        alias_normalized text NOT NULL,
        source text NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'manual')),
        is_active boolean NOT NULL DEFAULT true,
        deprecated_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_place_alias_target_one CHECK (
          (region_id IS NOT NULL AND place_id IS NULL)
          OR (region_id IS NULL AND place_id IS NOT NULL)
        )
      );
      CREATE INDEX idx_place_aliases_alias_normalized ON place_aliases(alias_normalized);
      CREATE UNIQUE INDEX uq_place_aliases_active ON place_aliases(
        target_kind,
        COALESCE(region_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(place_id, '00000000-0000-0000-0000-000000000000'::uuid),
        alias_normalized
      ) WHERE is_active;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_place_aliases_active`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_place_aliases_alias_normalized`);
    await queryRunner.query(`DROP TABLE IF EXISTS place_aliases`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_places_fias`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_places_is_active`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_places_region_kind_name`);
    await queryRunner.query(`DROP TABLE IF EXISTS places`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_regions_fias`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_regions_is_active`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_regions_name`);
    await queryRunner.query(`DROP TABLE IF EXISTS regions`);
  }
}
