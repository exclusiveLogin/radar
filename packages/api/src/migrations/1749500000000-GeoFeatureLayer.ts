import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Структурный гео-каталог: таблица geo_feature (геометрия OSM), place_geo_link
 * (привязка субъекта к его контуру) и поля name_stem / geo_feature_id на places.
 */
export class GeoFeatureLayer1749500000000 implements MigrationInterface {
  name = "GeoFeatureLayer1749500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- geo_feature: структурная геометрия OSM ---
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS geo_feature (
        id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        layer         text        NOT NULL,
        region_id     uuid        REFERENCES regions(id) ON DELETE RESTRICT,
        name          text        NOT NULL,
        name_stem     text        NOT NULL DEFAULT '',
        geometry      jsonb,
        bbox          jsonb,
        centroid_lat  numeric(9,6),
        centroid_lon  numeric(9,6),
        fias_id       text        UNIQUE,
        kladr_id      text,
        oktmo         text,
        source_file_key text,
        source_meta   jsonb       NOT NULL DEFAULT '{}'::jsonb,
        is_active     boolean     NOT NULL DEFAULT true,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_geo_feature_layer
        ON geo_feature(layer);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_geo_feature_region_layer_stem
        ON geo_feature(region_id, layer, name_stem);
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_geo_feature_region_layer_stem
        ON geo_feature(region_id, layer, name_stem)
        WHERE fias_id IS NULL AND is_active = true;
    `);

    // --- place_geo_link: субъект ↔ geo_feature(layer=subject) ---
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS place_geo_link (
        id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        place_id       uuid        NOT NULL REFERENCES places(id) ON DELETE CASCADE,
        geo_feature_id uuid        NOT NULL REFERENCES geo_feature(id) ON DELETE CASCADE,
        role           text        NOT NULL DEFAULT 'boundary',
        priority       integer     NOT NULL DEFAULT 0,
        created_at     timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_place_geo_link_place_feature
        ON place_geo_link(place_id, geo_feature_id);
    `);

    // --- places: добавляем name_stem и geo_feature_id ---
    await queryRunner.query(`
      ALTER TABLE places
        ADD COLUMN IF NOT EXISTS name_stem      text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS geo_feature_id uuid REFERENCES geo_feature(id) ON DELETE SET NULL;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_places_region_kind_name_stem
        ON places(region_id, kind, name_stem)
        WHERE is_active = true;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_places_geo_feature_id
        ON places(geo_feature_id)
        WHERE geo_feature_id IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_places_geo_feature_id;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_places_region_kind_name_stem;`);
    await queryRunner.query(`
      ALTER TABLE places
        DROP COLUMN IF EXISTS geo_feature_id,
        DROP COLUMN IF EXISTS name_stem;
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS place_geo_link;`);
    await queryRunner.query(`DROP TABLE IF EXISTS geo_feature;`);
  }
}
