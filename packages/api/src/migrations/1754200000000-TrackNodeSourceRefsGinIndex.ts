import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * GIN-индекс на mat_track_node.source_refs — ускоряет anti-join
 * TRACKING_PIPELINE_NOT_PROCESSED_SQL (NOT EXISTS ... source_refs @> ...),
 * который иначе идёт seq-scan'ом по mat_track_node на каждый tick tracking-раннера
 * и почти постоянно держит AccessShareLock на mat_parse_event/mat_parse_location.
 */
export class TrackNodeSourceRefsGinIndex1754200000000 implements MigrationInterface {
  name = "TrackNodeSourceRefsGinIndex1754200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_mat_track_node_source_refs
        ON mat_track_node USING gin (source_refs jsonb_path_ops)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_mat_track_node_source_refs`);
  }
}
