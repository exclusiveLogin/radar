import type { MigrationInterface, QueryRunner } from "typeorm";

export class DomainEventsOutbox1746481500000 implements MigrationInterface {
  name = "DomainEventsOutbox1746481500000";public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE domain_events (
        id uuid PRIMARY KEY,
        type text NOT NULL,
        version int NOT NULL DEFAULT 1,
        aggregate_type text NOT NULL,
        aggregate_id text,
        payload jsonb NOT NULL,
        occurred_at timestamptz NOT NULL,
        published_at timestamptz,
        trace_id text
      );
      CREATE INDEX idx_domain_events_unpublished ON domain_events(published_at) WHERE published_at IS NULL;
      CREATE INDEX idx_domain_events_type_occurred ON domain_events(type, occurred_at DESC);
      CREATE INDEX idx_domain_events_aggregate ON domain_events(aggregate_type, aggregate_id);
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION notify_domain_events_new()
      RETURNS trigger AS $$
      BEGIN
        PERFORM pg_notify('domain_events_new', NEW.id::text);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.query(`
      CREATE TRIGGER trg_domain_events_notify
      AFTER INSERT ON domain_events
      FOR EACH ROW
      EXECUTE FUNCTION notify_domain_events_new();
    `);
  }public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_domain_events_notify ON domain_events`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS notify_domain_events_new`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_domain_events_aggregate`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_domain_events_type_occurred`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_domain_events_unpublished`);
    await queryRunner.query(`DROP TABLE IF EXISTS domain_events`);
  }
}
