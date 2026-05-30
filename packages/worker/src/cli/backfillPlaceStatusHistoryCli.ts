import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerDataSource } from "../infrastructure/persistence/createWorkerDataSource.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";

/**
 * Одноразово: place_status_history из place_status_active (для WS-поллера после апгрейда).
 */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const ds = await createWorkerDataSource();
  const result = (await ds.query(`
    INSERT INTO place_status_history (id, place_id, status_code, action, source, event_at, meta)
    SELECT gen_random_uuid(), psa.place_id, psa.status_code, 'activate', psa.source, psa.updated_at, psa.meta
    FROM place_status_active psa
    WHERE NOT EXISTS (
      SELECT 1 FROM place_status_history h
      WHERE h.place_id = psa.place_id
        AND h.status_code = psa.status_code
        AND h.action = 'activate'
    )
  `)) as unknown;
  console.log("Backfill place_status_history:", result);
  await ds.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
