import type { MigrationInterface, QueryRunner } from "typeorm";

/** scope_radius_m для vicinity scope на event_locations. */
export class EventLocationScopeRadius1751200000000 implements MigrationInterface {
  name = "EventLocationScopeRadius1751200000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE event_locations
        ADD COLUMN IF NOT EXISTS scope_radius_m NUMERIC(10, 2) NULL;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE event_locations
        DROP COLUMN IF EXISTS scope_radius_m;
    `);
  }
}
