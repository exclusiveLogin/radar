import type { MigrationInterface, QueryRunner } from "typeorm";



/**

 * region-place SSOT: place(kind=region) на regions.id; place_aliases только на place_id.

 */

export class RegionCanonicalPlace1749300000000 implements MigrationInterface {

  name = "RegionCanonicalPlace1749300000000";



  public async up(queryRunner: QueryRunner): Promise<void> {

    await queryRunner.query(`

      INSERT INTO places (

        id, region_id, kind, name, name_with_type, name_normalized,

        fias_id, kladr_id, centroid_lat, centroid_lon, bbox, geometry_artifact_key,

        last_source_revision, is_active, trust_state, is_trusted

      )

      SELECT

        gen_random_uuid(),

        r.id,

        'region',

        r.name,

        r.name_with_type,

        trim(regexp_replace(

          regexp_replace(lower(replace(r.name, 'ё', 'е')), '[^[:alnum:]]+', ' ', 'g'),

          '\\s+', ' ', 'g'

        )),

        CASE

          WHEN r.fias_id IS NOT NULL AND EXISTS (

            SELECT 1 FROM places taken WHERE taken.fias_id = r.fias_id

          ) THEN NULL

          ELSE r.fias_id

        END,

        r.kladr_id,

        r.centroid_lat,

        r.centroid_lon,

        r.bbox,

        r.geometry_artifact_key,

        r.last_source_revision,

        true,

        'verified',

        true

      FROM regions r

      WHERE r.is_active = true

        AND NOT EXISTS (

          SELECT 1 FROM places p

          WHERE p.region_id = r.id AND p.kind = 'region' AND p.is_active = true

        );

    `);



    await queryRunner.query(`

      INSERT INTO place_aliases (

        id, target_kind, region_id, place_id, alias, alias_normalized, source, is_active

      )

      SELECT

        gen_random_uuid(),

        'place',

        NULL,

        p.id,

        pa.alias,

        pa.alias_normalized,

        pa.source,

        true

      FROM place_aliases pa

      INNER JOIN regions r ON r.id = pa.region_id

      INNER JOIN places p ON p.region_id = r.id AND p.kind = 'region' AND p.is_active = true

      WHERE pa.target_kind = 'region'

        AND pa.is_active = true

        AND NOT EXISTS (

          SELECT 1 FROM place_aliases existing

          WHERE existing.is_active = true

            AND existing.place_id = p.id

            AND existing.alias_normalized = pa.alias_normalized

        );

    `);



    await queryRunner.query(`

      DELETE FROM place_aliases WHERE target_kind = 'region';

    `);



    await queryRunner.query(`DROP INDEX IF EXISTS uq_place_aliases_active;`);

    await queryRunner.query(`

      CREATE UNIQUE INDEX IF NOT EXISTS uq_place_aliases_place_alias

      ON place_aliases(place_id, alias_normalized)

      WHERE is_active AND place_id IS NOT NULL;

    `);



    await queryRunner.query(`

      ALTER TABLE place_aliases DROP CONSTRAINT IF EXISTS chk_place_alias_target_one;

    `);

    await queryRunner.query(`

      ALTER TABLE place_aliases

      ADD CONSTRAINT chk_place_alias_place_only

      CHECK (place_id IS NOT NULL AND region_id IS NULL);

    `);

  }



  public async down(queryRunner: QueryRunner): Promise<void> {

    await queryRunner.query(`

      ALTER TABLE place_aliases DROP CONSTRAINT IF EXISTS chk_place_alias_place_only;

    `);

    await queryRunner.query(`

      ALTER TABLE place_aliases

      ADD CONSTRAINT chk_place_alias_target_one

      CHECK (

        (region_id IS NOT NULL AND place_id IS NULL)

        OR (region_id IS NULL AND place_id IS NOT NULL)

      );

    `);

    await queryRunner.query(`DROP INDEX IF EXISTS uq_place_aliases_place_alias;`);

    await queryRunner.query(`

      CREATE UNIQUE INDEX IF NOT EXISTS uq_place_aliases_active ON place_aliases(

        target_kind,

        COALESCE(region_id, '00000000-0000-0000-0000-000000000000'::uuid),

        COALESCE(place_id, '00000000-0000-0000-0000-000000000000'::uuid),

        alias_normalized

      ) WHERE is_active;

    `);

  }

}

