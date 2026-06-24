import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Переименование mass_warning → warning (тип предупреждения без встроенной массовости).
 */
export class MassWarningToWarning1751400000000 implements MigrationInterface {
  name = "MassWarningToWarning1751400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE status_dictionary
      SET code = 'warning',
          title = 'Предупреждение',
          parser_hints = ARRAY['warning']
      WHERE code = 'mass_warning';
    `);
    await queryRunner.query(`
      UPDATE parsed_events
      SET event_type = 'warning'
      WHERE event_type = 'mass_warning';
    `);
    await queryRunner.query(`
      UPDATE event_locations
      SET status_code = 'warning'
      WHERE status_code = 'mass_warning';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE event_locations
      SET status_code = 'mass_warning'
      WHERE status_code = 'warning';
    `);
    await queryRunner.query(`
      UPDATE parsed_events
      SET event_type = 'mass_warning'
      WHERE event_type = 'warning';
    `);
    await queryRunner.query(`
      UPDATE status_dictionary
      SET code = 'mass_warning',
          title = 'Тревога',
          parser_hints = ARRAY['mass_warning']
      WHERE code = 'warning';
    `);
  }
}
