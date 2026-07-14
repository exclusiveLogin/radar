import type { MigrationInterface, QueryRunner } from "typeorm";

/** RMQ idempotency + transport audit (ADR-022). */
export class RmqTransportDedup1753000000000 implements MigrationInterface {
  name = "RmqTransportDedup1753000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS transport_dedup (
        event_id text PRIMARY KEY,
        consumed_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_transport_dedup_consumed_at
        ON transport_dedup(consumed_at);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS transport_dedup`);
  }
}
