import type { MigrationInterface, QueryRunner } from "typeorm";

export class Initial1735689600000 implements MigrationInterface {
  name = "Initial1735689600000";

  public async up(_queryRunner: QueryRunner): Promise<void> {
    /* Схема домена — в следующих итерациях. */
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {}
}
