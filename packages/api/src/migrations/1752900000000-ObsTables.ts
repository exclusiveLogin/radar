import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Observability BC: obs_* таблицы для embedded runtime snapshots.
 * @see ../../../../docs/rfc/adr-017-observability-embedded.md
 * @see ../../../../docs/database-table-naming.md
 */
export class ObsTables1752900000000 implements MigrationInterface {
  name = "ObsTables1752900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE obs_hosts (
        host_id text PRIMARY KEY,
        role text NOT NULL,
        started_at timestamptz NOT NULL,
        last_seen_at timestamptz NOT NULL,
        odp_runtime jsonb NOT NULL DEFAULT '[]'::jsonb,
        metrics jsonb
      );
    `);

    await queryRunner.query(`
      CREATE TABLE obs_executors (
        executor_id text PRIMARY KEY,
        host_id text NOT NULL REFERENCES obs_hosts(host_id) ON DELETE CASCADE,
        kind text NOT NULL,
        parent_id text,
        last_seen_at timestamptz NOT NULL,
        status text NOT NULL,
        metrics jsonb
      );
      CREATE INDEX idx_obs_executors_host_id ON obs_executors(host_id);
    `);

    await queryRunner.query(`
      CREATE TABLE obs_workloads (
        workload_id text PRIMARY KEY,
        host_id text NOT NULL REFERENCES obs_hosts(host_id) ON DELETE CASCADE,
        pipeline_key text NOT NULL,
        runtime text NOT NULL,
        status text NOT NULL,
        last_tick_at timestamptz,
        metrics jsonb
      );
      CREATE INDEX idx_obs_workloads_host_id ON obs_workloads(host_id);
      CREATE INDEX idx_obs_workloads_pipeline_key ON obs_workloads(pipeline_key);
    `);

    await queryRunner.query(`
      CREATE TABLE obs_trigger_counters (
        pipeline_key text NOT NULL,
        event_type text NOT NULL,
        source text NOT NULL,
        count bigint NOT NULL DEFAULT 0,
        PRIMARY KEY (pipeline_key, event_type, source)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE obs_materialize_counters (
        pipeline_key text PRIMARY KEY,
        count bigint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS obs_materialize_counters`);
    await queryRunner.query(`DROP TABLE IF EXISTS obs_trigger_counters`);
    await queryRunner.query(`DROP TABLE IF EXISTS obs_workloads`);
    await queryRunner.query(`DROP TABLE IF EXISTS obs_executors`);
    await queryRunner.query(`DROP TABLE IF EXISTS obs_hosts`);
  }
}
