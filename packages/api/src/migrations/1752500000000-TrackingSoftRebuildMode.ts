import type { MigrationInterface, QueryRunner } from "typeorm";

/** Режим soft_rebuild: пересборка треков без смены config и без выключения пайплайна. */
export class TrackingSoftRebuildMode1752500000000 implements MigrationInterface {
  name = "TrackingSoftRebuildMode1752500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE trajectory_rebuild_runs
      DROP CONSTRAINT IF EXISTS trajectory_rebuild_runs_mode_check
    `);
    await queryRunner.query(`
      ALTER TABLE trajectory_rebuild_runs
      ADD CONSTRAINT trajectory_rebuild_runs_mode_check
      CHECK (mode IN ('incremental', 'full_rebuild', 'soft_rebuild'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE trajectory_rebuild_runs
      DROP CONSTRAINT IF EXISTS trajectory_rebuild_runs_mode_check
    `);
    await queryRunner.query(`
      ALTER TABLE trajectory_rebuild_runs
      ADD CONSTRAINT trajectory_rebuild_runs_mode_check
      CHECK (mode IN ('incremental', 'full_rebuild'))
    `);
  }
}
