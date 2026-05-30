import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Семантика SSOT: danger = красная группа (опасность), attention = жёлтая (внимание).
 * Жёлтый на карте у соседа — только через neighbor-red в regionStateMachine.
 */
export class FixDangerStatusLevelRed1747400000000 implements MigrationInterface {
  name = "FixDangerStatusLevelRed1747400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE status_dictionary
      SET state_level = 'red', priority = 25
      WHERE code = 'danger';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE status_dictionary
      SET state_level = 'yellow', priority = 30
      WHERE code = 'danger';
    `);
  }
}
