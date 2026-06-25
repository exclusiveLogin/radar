import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * ADR-008: флаг affects_kinematics на status_dictionary.
 * false → attach_only (ПВО-отчёт, отбой); true/null → correct по resolveNodeMode.
 */
export class StatusDictionaryAffectsKinematics1752100000000 implements MigrationInterface {
  name = "StatusDictionaryAffectsKinematics1752100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE status_dictionary
      ADD COLUMN IF NOT EXISTS affects_kinematics boolean;
    `);

    await queryRunner.query(`
      UPDATE status_dictionary
      SET affects_kinematics = false
      WHERE code IN ('pvo_report', 'pvo_work', 'cleared', 'stale', 'safety_measures');
    `);

    await queryRunner.query(`
      UPDATE status_dictionary
      SET affects_kinematics = true
      WHERE affects_kinematics IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE status_dictionary DROP COLUMN IF EXISTS affects_kinematics;
    `);
  }
}
