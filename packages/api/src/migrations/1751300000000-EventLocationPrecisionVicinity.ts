import type { MigrationInterface, QueryRunner } from "typeorm";

/** Расширить CHECK precision: vicinity для scope-колец finalizer. */
export class EventLocationPrecisionVicinity1751300000000 implements MigrationInterface {
  name = "EventLocationPrecisionVicinity1751300000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE event_locations
        DROP CONSTRAINT IF EXISTS event_locations_precision_check;
    `);
    await queryRunner.query(`
      ALTER TABLE event_locations
        ADD CONSTRAINT event_locations_precision_check
        CHECK (precision IN (
          'region', 'district', 'city', 'locality', 'settlement', 'vicinity'
        ));
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE event_locations
        DROP CONSTRAINT IF EXISTS event_locations_precision_check;
    `);
    await queryRunner.query(`
      ALTER TABLE event_locations
        ADD CONSTRAINT event_locations_precision_check
        CHECK (precision IN (
          'region', 'district', 'city', 'locality', 'settlement'
        ));
    `);
  }
}
