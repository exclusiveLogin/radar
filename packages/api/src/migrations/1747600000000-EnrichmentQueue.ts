import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Очередь фонового гео-обогащения. Одна задача на raw_message (UNIQUE):
 * синхронный catalog-парсинг ставит pending, фоновый потребитель догоняет
 * полным пайплайном и обновляет проекцию. ON CONFLICT DO NOTHING при enqueue.
 */
export class EnrichmentQueue1747600000000 implements MigrationInterface {
  name = "EnrichmentQueue1747600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS enrichment_queue (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        raw_message_id uuid NOT NULL REFERENCES raw_messages(id) ON DELETE CASCADE,
        parsed_event_id uuid REFERENCES parsed_events(id) ON DELETE CASCADE,
        status text NOT NULL DEFAULT 'pending',
        attempts integer NOT NULL DEFAULT 0,
        last_error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_enrichment_queue_raw_message UNIQUE (raw_message_id)
      );
      CREATE INDEX IF NOT EXISTS idx_enrichment_queue_status_created
      ON enrichment_queue(status, created_at);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_enrichment_queue_status_created`);
    await queryRunner.query(`DROP TABLE IF EXISTS enrichment_queue`);
  }
}
