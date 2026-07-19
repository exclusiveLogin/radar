import type { MigrationInterface, QueryRunner } from "typeorm";

/** Переименовываем уровень 'yellow' → 'orange' в status_dictionary.
 *  'yellow' теперь зарезервирован исключительно для производных соседей (read-side). */
export class YellowToOrange1750100000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE status_dictionary
      SET state_level = 'orange'
      WHERE state_level = 'yellow'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE status_dictionary
      SET state_level = 'yellow'
      WHERE state_level = 'orange'
    `);
  }
}
