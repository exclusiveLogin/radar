import type { MigrationInterface, QueryRunner } from "typeorm";

/** Разрешаем kind=city_district для catalog places из OSM import. */
export class PlaceKindCityDistrict1749600000000 implements MigrationInterface {
  name = "PlaceKindCityDistrict1749600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE places DROP CONSTRAINT IF EXISTS places_kind_check;
    `);
    await queryRunner.query(`
      ALTER TABLE places
      ADD CONSTRAINT places_kind_check CHECK (
        kind IN (
          'region','district','city_district','city',
          'locality','settlement','urban_okrug','mo_go'
        )
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE places DROP CONSTRAINT IF EXISTS places_kind_check;
    `);
    await queryRunner.query(`
      ALTER TABLE places
      ADD CONSTRAINT places_kind_check CHECK (
        kind IN ('region','district','city','locality','settlement','urban_okrug','mo_go')
      );
    `);
  }
}
