import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * consumed — OLAP-учёт пайплайна, не OLTP-ссылка на event_locations.
 * FK вызывал блокировки event_locations ↔ TRUNCATE consumed (deadlock с worker/API).
 */
export class TrackingConsumedDropOltpFk1752600000000 implements MigrationInterface {
  name = "TrackingConsumedDropOltpFk1752600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tracking_pipeline_consumed
      DROP CONSTRAINT IF EXISTS tracking_pipeline_consumed_event_location_id_fkey
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tracking_pipeline_consumed
      ADD CONSTRAINT tracking_pipeline_consumed_event_location_id_fkey
      FOREIGN KEY (event_location_id) REFERENCES event_locations(id) ON DELETE CASCADE
    `);
  }
}
