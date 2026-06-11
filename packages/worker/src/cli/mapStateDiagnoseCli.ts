import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerDataSource } from "../infrastructure/persistence/createWorkerDataSource.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { resolveMapStateTtlMs } from "../infrastructure/config/mapStateExpiryConfig.js";

/** Диагностика read-model: что ещё «горит» и почему expire мог не тронуть. */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const ttlMs = resolveMapStateTtlMs();
  const dataSource = await createWorkerDataSource();
  const cutoff = new Date(Date.now() - ttlMs).toISOString();

  const [summary] = (await dataSource.query(
    `
    SELECT
      COUNT(*) FILTER (WHERE stale = false AND action = 'raise') AS active_raise,
      COUNT(*) FILTER (WHERE stale = true) AS stale_rows,
      COUNT(*) FILTER (
        WHERE stale = false AND action = 'raise'
          AND winner_occurred_at < $1::timestamptz
      ) AS raise_older_than_ttl_unmarked
    FROM region_status_read_model
    `,
    [cutoff],
  )) as Array<Record<string, string>>;

  const activeRegions = (await dataSource.query(
    `
    SELECT region_code, state_level, action, stale, status_code,
           winner_occurred_at,
           now() - winner_occurred_at AS age
    FROM region_status_read_model
    WHERE stale = false AND action = 'raise'
    ORDER BY winner_occurred_at ASC
    LIMIT 30
    `,
  )) as Array<Record<string, unknown>>;

  const activePlaces = (await dataSource.query(
    `
    SELECT p.name, r.iso AS region_code, psm.state_level, psm.stale, psm.status_code,
           psm.winner_occurred_at,
           now() - psm.winner_occurred_at AS age
    FROM place_status_read_model psm
    JOIN places p ON p.id = psm.place_id
    JOIN regions r ON r.id = psm.region_id
    WHERE psm.stale = false AND psm.action = 'raise'
    ORDER BY psm.winner_occurred_at ASC
    LIMIT 30
    `,
  )) as Array<Record<string, unknown>>;

  const staleRegions = (await dataSource.query(
    `
    SELECT region_code, state_level, action, winner_occurred_at, stale_at, updated_at
    FROM region_status_read_model
    WHERE stale = true
    ORDER BY stale_at DESC NULLS LAST
    LIMIT 15
    `,
  )) as Array<Record<string, unknown>>;

  const nearTtlExpiry = (await dataSource.query(
    `
    SELECT region_code, state_level, stale, winner_occurred_at,
           now() - winner_occurred_at AS age
    FROM region_status_read_model
    WHERE stale = false AND action = 'raise'
      AND winner_occurred_at < now() - interval '23 hours'
    ORDER BY winner_occurred_at ASC
    LIMIT 10
    `,
  )) as Array<Record<string, unknown>>;

  console.log(JSON.stringify({
    ttlMs,
    ttlHours: ttlMs / (60 * 60 * 1000),
    cutoff,
    regionSummary: summary,
    staleRegions,
    nearTtlExpiry,
    activeRaiseRegions: activeRegions,
    activeRaisePlaces: activePlaces,
  }, null, 2));

  await dataSource.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
