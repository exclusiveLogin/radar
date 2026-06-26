import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Учёт pipeline-точек, прошедших батч (в т.ч. skip/dedup без ноды).
 * Без этого watermark «перепрыгивает» сирот и пайплайн останавливается на ~30%.
 */
export class TrackingPipelineConsumed1752400000000 implements MigrationInterface {
  name = "TrackingPipelineConsumed1752400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE tracking_pipeline_consumed (
        event_location_id UUID PRIMARY KEY REFERENCES event_locations(id) ON DELETE CASCADE,
        consumed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        reason TEXT NOT NULL DEFAULT 'batch'
      );
    `);

    await queryRunner.query(`
      INSERT INTO tracking_pipeline_consumed (event_location_id, reason)
      SELECT DISTINCT (ref->>'eventLocationId')::uuid, 'node_backfill'
      FROM trajectory_nodes tn
      CROSS JOIN LATERAL jsonb_array_elements(tn.source_refs) AS ref
      WHERE ref->>'eventLocationId' ~ '^[0-9a-f-]{36}$'
      ON CONFLICT (event_location_id) DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS tracking_pipeline_consumed`);
  }
}
