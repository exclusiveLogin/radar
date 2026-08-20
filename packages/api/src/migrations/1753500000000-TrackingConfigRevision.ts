import type { MigrationInterface, QueryRunner } from "typeorm";

/** Разделяет сохранённую настройку и revision, применённый текущим derived state. */
export class TrackingConfigRevision1753500000000 implements MigrationInterface {
  name = "TrackingConfigRevision1753500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE state_track_pipeline
      ADD COLUMN IF NOT EXISTS config_revision BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS applied_config_revision BIGINT NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      UPDATE job_track_rebuild
      SET mode = 'full_rebuild'
      WHERE mode = 'soft_rebuild'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE state_track_pipeline
      DROP COLUMN IF EXISTS applied_config_revision,
      DROP COLUMN IF EXISTS config_revision
    `);
  }
}
