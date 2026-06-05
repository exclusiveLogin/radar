import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Исправляет уровень угрозы для rocket_threat: orange → red.
 * Семантически «ракетная опасность» = прямая угроза региону, эквивалент danger (red),
 * только с типом rocket — поэтому оба должны иметь state_level = 'red'.
 */
export class RocketThreatRedLevel1749700000000 implements MigrationInterface {
  name = "RocketThreatRedLevel1749700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE status_dictionary
      SET state_level = 'red', priority = 20
      WHERE code = 'rocket_threat';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE status_dictionary
      SET state_level = 'orange', priority = 20
      WHERE code = 'rocket_threat';
    `);
  }
}
