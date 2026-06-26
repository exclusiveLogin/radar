import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Колонка regions.front_distance_km — precomputed гео-дистанция (км) от центроида
 * региона до ближайшего фронт-региона. Источник веса близости к фронту (data-driven),
 * заполняется сидером seed-regions-catalog из геометрии. Nullable: тыл без центроида
 * → домен падает на boolean-фолбэк coeff.
 */
export class RegionFrontDistance1752300000000 implements MigrationInterface {
  name = "RegionFrontDistance1752300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE regions
        ADD COLUMN IF NOT EXISTS front_distance_km double precision
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE regions
        DROP COLUMN IF EXISTS front_distance_km
    `);
  }
}
