import type { MigrationInterface, QueryRunner } from "typeorm";

/** Индексы для fold read-line: range scan по occurred_at и channel-clear. */
export class EventLocationsFoldReadIndexes1751100000000 implements MigrationInterface {
  name = "EventLocationsFoldReadIndexes1751100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_event_locations_occurred_at
      ON event_locations (occurred_at DESC);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_event_locations_raise_occurred_at
      ON event_locations (occurred_at DESC)
      WHERE action = 'raise';
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_raw_messages_posted_at
      ON raw_messages (posted_at DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_raw_messages_posted_at`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_event_locations_raise_occurred_at`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_event_locations_occurred_at`);
  }
}
