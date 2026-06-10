import type { MigrationInterface, QueryRunner } from "typeorm";

/** Смежность субъектов РФ из adjacency.json для map/status logic. */
export class RegionAdjacency1749600000000 implements MigrationInterface {
  name = "RegionAdjacency1749600000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS region_adjacency (
        region_id          uuid NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
        neighbor_region_id uuid NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
        PRIMARY KEY (region_id, neighbor_region_id)
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_region_adjacency_neighbor
        ON region_adjacency(neighbor_region_id);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS region_adjacency;`);
  }
}
