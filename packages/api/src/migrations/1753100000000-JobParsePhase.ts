import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * ADR-025 D3: queue_parse_coverage → job_parse_phase, log_parse_phase_run → log_phase_run.
 */
export class JobParsePhase1753100000000 implements MigrationInterface {
  name = "JobParsePhase1753100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE queue_parse_coverage RENAME TO job_parse_phase`);
    await queryRunner.query(`ALTER TABLE log_parse_phase_run RENAME TO log_phase_run`);
    await queryRunner.query(
      `ALTER INDEX IF EXISTS uq_queue_parse_coverage_raw_phase RENAME TO uq_job_parse_phase_raw_phase`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER INDEX IF EXISTS uq_job_parse_phase_raw_phase RENAME TO uq_queue_parse_coverage_raw_phase`,
    );
    await queryRunner.query(`ALTER TABLE log_phase_run RENAME TO log_parse_phase_run`);
    await queryRunner.query(`ALTER TABLE job_parse_phase RENAME TO queue_parse_coverage`);
  }
}
