import type { MigrationInterface, QueryRunner } from "typeorm";

export class DropLegacyStatusTables1749000000000 implements MigrationInterface {
  name = "DropLegacyStatusTables1749000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS place_status_history`);
    await queryRunner.query(`DROP TABLE IF EXISTS place_status_active`);
    await queryRunner.query(`DROP TABLE IF EXISTS region_state_history`);
    await queryRunner.query(`DROP TABLE IF EXISTS region_state_active`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS region_state_active (
        region_id uuid PRIMARY KEY REFERENCES regions(id) ON DELETE CASCADE,
        region_code text NOT NULL,
        state_level text NOT NULL,
        self_level text NOT NULL,
        activity int NOT NULL DEFAULT 0,
        reason text,
        updated_at timestamptz NOT NULL DEFAULT now(),
        status_event_at timestamptz
      );
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS region_state_history (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        region_id uuid NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
        region_code text NOT NULL,
        state_level text NOT NULL,
        previous_level text NOT NULL,
        reason text,
        changed_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS place_status_active (
        place_id uuid NOT NULL REFERENCES places(id) ON DELETE CASCADE,
        status_code text NOT NULL REFERENCES status_dictionary(code) ON DELETE RESTRICT,
        source text NOT NULL,
        started_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        meta jsonb NOT NULL DEFAULT '{}'::jsonb,
        PRIMARY KEY(place_id, status_code)
      );
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS place_status_history (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        place_id uuid NOT NULL REFERENCES places(id) ON DELETE CASCADE,
        status_code text NOT NULL REFERENCES status_dictionary(code) ON DELETE RESTRICT,
        action text NOT NULL,
        source text NOT NULL,
        event_at timestamptz NOT NULL DEFAULT now(),
        meta jsonb NOT NULL DEFAULT '{}'::jsonb
      );
    `);
  }
}
