import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * NextGen Фаза 2: промежуточные отрезки (segment_only) для пунктира на карте.
 */
export class TrajectoryNodeSegmentOnlyMode1752700000000 implements MigrationInterface {
  name = "TrajectoryNodeSegmentOnlyMode1752700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE trajectory_nodes
      DROP CONSTRAINT IF EXISTS trajectory_nodes_mode_check
    `);
    await queryRunner.query(`
      ALTER TABLE trajectory_nodes
      ADD CONSTRAINT trajectory_nodes_mode_check
      CHECK (mode IN ('correct', 'attach_only', 'segment_only'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE trajectory_nodes
      DROP CONSTRAINT IF EXISTS trajectory_nodes_mode_check
    `);
    await queryRunner.query(`
      ALTER TABLE trajectory_nodes
      ADD CONSTRAINT trajectory_nodes_mode_check
      CHECK (mode IN ('correct', 'attach_only'))
    `);
  }
}
