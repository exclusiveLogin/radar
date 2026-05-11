import type { MigrationInterface, QueryRunner } from "typeorm";

export class EventSubscriptions1746481600000 implements MigrationInterface {
  name = "EventSubscriptions1746481600000";public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE event_subscriptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL UNIQUE,
        event_types text[] NOT NULL DEFAULT ARRAY[]::text[],
        last_event_id uuid,
        last_processed_at timestamptz,
        status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'error')),
        error_message text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_event_subscriptions_status ON event_subscriptions(status);
      CREATE INDEX idx_event_subscriptions_last_event ON event_subscriptions(last_event_id);
    `);
  }public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_event_subscriptions_last_event`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_event_subscriptions_status`);
    await queryRunner.query(`DROP TABLE IF EXISTS event_subscriptions`);
  }
}
