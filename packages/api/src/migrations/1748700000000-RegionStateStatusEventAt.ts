import type { MigrationInterface, QueryRunner } from "typeorm";

/** Время MessageParsed (postedAt), выставившего текущий срез region_state_active. */
export class RegionStateStatusEventAt1748700000000 implements MigrationInterface {
  name = "RegionStateStatusEventAt1748700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE region_state_active
      ADD COLUMN IF NOT EXISTS status_event_at timestamptz;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE region_state_active
      DROP COLUMN IF EXISTS status_event_at;
    `);
  }
}
