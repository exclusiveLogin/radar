import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Per-provider очередь обогащения (ADR-003, Фаза D): строка на пару
 * `(raw_message_id, stage)`. Существующие задачи переносятся на stage='llm'.
 * Уникальность переезжает с `(raw_message_id)` на `(raw_message_id, stage)`,
 * что и даёт защиту от петли ре-энкью (done не сбрасывается).
 */
export class EnrichmentQueueStage1748300000000 implements MigrationInterface {
  name = "EnrichmentQueueStage1748300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE enrichment_queue ADD COLUMN IF NOT EXISTS stage text;
      UPDATE enrichment_queue SET stage = 'llm' WHERE stage IS NULL;
      ALTER TABLE enrichment_queue ALTER COLUMN stage SET NOT NULL;
      ALTER TABLE enrichment_queue DROP CONSTRAINT IF EXISTS uq_enrichment_queue_raw_message;
      ALTER TABLE enrichment_queue
        ADD CONSTRAINT uq_enrichment_queue_raw_stage UNIQUE (raw_message_id, stage);
      CREATE INDEX IF NOT EXISTS idx_enrichment_queue_stage_status_created
      ON enrichment_queue(stage, status, created_at);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_enrichment_queue_stage_status_created;
      ALTER TABLE enrichment_queue DROP CONSTRAINT IF EXISTS uq_enrichment_queue_raw_stage;
      ALTER TABLE enrichment_queue
        ADD CONSTRAINT uq_enrichment_queue_raw_message UNIQUE (raw_message_id);
      ALTER TABLE enrichment_queue DROP COLUMN IF EXISTS stage;
    `);
  }
}
