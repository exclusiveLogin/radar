import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Добавляет уровень состояния региона (`state_level`) в словарь статусов
 * и сидирует базовый набор статусов: маппинг event->status->level как SSOT.
 */
export class StatusDictionaryStateLevel1747200000000 implements MigrationInterface {
  name = "StatusDictionaryStateLevel1747200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE status_dictionary
      ADD COLUMN IF NOT EXISTS state_level text NOT NULL DEFAULT 'grey';
    `);

    // Базовый словарь: code = семантика статуса, parser_hints = типы событий парсера.
    await queryRunner.query(`
      INSERT INTO status_dictionary (code, title, include_on_map, parser_hints, state_level, is_active, priority)
      VALUES
        ('fixation',            'Фиксация БПЛА',     true, ARRAY['fixation'],            'red',    true, 10),
        ('pvo_work',            'Работа ПВО',        true, ARRAY['pvo_work'],            'red',    true, 10),
        ('impact',              'Поражение/сбитие',  true, ARRAY['impact'],              'red',    true, 15),
        ('rocket_threat',       'Ракетная опасность',true, ARRAY['rocket_threat'],       'orange', true, 20),
        ('mass_warning',        'Тревога',           true, ARRAY['mass_warning'],        'yellow', true, 32),
        ('danger',              'Опасность по БПЛА', true, ARRAY['danger'],              'red',    true, 25),
        ('attention',           'Внимание',          true, ARRAY['attention'],           'yellow', true, 35),
        ('safety_measures',     'Меры безопасности', true, ARRAY['safety_measures'],     'yellow', true, 40),
        ('airspace_restriction','Ограничение ИВП',   true, ARRAY['airspace_restriction'],'yellow', true, 45),
        ('cleared',             'Отбой',             true, ARRAY['cleared'],             'green',  true, 90)
      ON CONFLICT (code) DO UPDATE SET
        title = EXCLUDED.title,
        include_on_map = EXCLUDED.include_on_map,
        parser_hints = EXCLUDED.parser_hints,
        state_level = EXCLUDED.state_level,
        is_active = EXCLUDED.is_active,
        priority = EXCLUDED.priority;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM status_dictionary
      WHERE code IN (
        'fixation','pvo_work','impact','rocket_threat','mass_warning',
        'danger','attention','safety_measures','airspace_restriction','cleared'
      );
    `);
    await queryRunner.query(`
      ALTER TABLE status_dictionary DROP COLUMN IF EXISTS state_level;
    `);
  }
}
