import type { MigrationInterface, QueryRunner } from "typeorm";

export class GeoDatasetFile1746480000000 implements MigrationInterface {
  name = "GeoDatasetFile1746480000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE geo_dataset_file (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        artifact_key text NOT NULL UNIQUE,
        rel_path text NOT NULL,
        sha256_hex text NOT NULL,
        byte_size bigint NOT NULL,
        source_id text NOT NULL,
        source_revision text,
        clone_url text,
        manifest_version int NOT NULL DEFAULT 1,
        meta jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_geo_dataset_file_source_id ON geo_dataset_file (source_id);
      CREATE INDEX idx_geo_dataset_file_sha256 ON geo_dataset_file (sha256_hex);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS geo_dataset_file`);
  }
}
