import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * region-place без обратной ссылки: один активный place(kind=region) на regions.id.
 */
export class RegionPlaceUniqueIndex1749400000000 implements MigrationInterface {
  name = "RegionPlaceUniqueIndex1749400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_regions_canonical_place_id;`);
    await queryRunner.query(`
      ALTER TABLE regions DROP COLUMN IF EXISTS canonical_place_id;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_places_region_kind_region_active
      ON places(region_id)
      WHERE kind = 'region' AND is_active;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_places_region_kind_region_active;`);
    await queryRunner.query(`
      ALTER TABLE regions
      ADD COLUMN IF NOT EXISTS canonical_place_id uuid REFERENCES places(id) ON DELETE RESTRICT;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_regions_canonical_place_id
      ON regions(canonical_place_id)
      WHERE canonical_place_id IS NOT NULL;
    `);
    await queryRunner.query(`
      UPDATE regions r
      SET canonical_place_id = p.id
      FROM places p
      WHERE p.region_id = r.id
        AND p.kind = 'region'
        AND p.is_active = true
        AND r.canonical_place_id IS NULL;
    `);
  }
}
