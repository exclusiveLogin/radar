import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Добавляет два новых типа событий в status_dictionary:
 * - intercept  — оперативное сбитие БПЛА/МВШ/ракеты, красный уровень, влияет на карту.
 * - pvo_report — сводная статистика ПВО за период, не влияет на карту.
 */
export class InterceptPvoReport1749900000000 implements MigrationInterface {
  name = "InterceptPvoReport1749900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO status_dictionary (code, title, state_level, priority, include_on_map)
      VALUES
        ('intercept',  'Сбитие',     'red',  12, true),
        ('pvo_report', 'Сводка ПВО', 'grey',  5, false)
      ON CONFLICT (code) DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM status_dictionary WHERE code IN ('intercept', 'pvo_report');
    `);
  }
}
