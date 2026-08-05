import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Singleton-слот backfill: 1 binding = 1 row.
 * История запусков не хранится — перед UNIQUE очищаем таблицу.
 */
export class BackfillJobBindingUnique1753900000000 implements MigrationInterface {
  name = "BackfillJobBindingUnique1753900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`TRUNCATE TABLE job_ingest_backfill`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_job_ingest_backfill_binding_id
        ON job_ingest_backfill (binding_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS uq_job_ingest_backfill_binding_id
    `);
  }
}
