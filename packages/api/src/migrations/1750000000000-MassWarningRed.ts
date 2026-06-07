import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Повышает уровень mass_warning (тревога, волна БПЛА) с yellow до red.
 * Семантически «тревога» = немедленная угроза, требует укрытия — эквивалент danger.
 */
export class MassWarningRed1750000000000 implements MigrationInterface {
  name = "MassWarningRed1750000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE status_dictionary
      SET state_level = 'red', priority = 22
      WHERE code = 'mass_warning';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE status_dictionary
      SET state_level = 'yellow', priority = 32
      WHERE code = 'mass_warning';
    `);
  }
}
