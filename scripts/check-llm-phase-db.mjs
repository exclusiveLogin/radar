import dotenv from "dotenv";
import pg from "pg";

dotenv.config();
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const phases = await c.query(
  "SELECT id, trigger, enabled, order_index FROM phase_definitions ORDER BY order_index",
);
console.log("=== phase_definitions ===");
console.table(phases.rows);

const cov = await c.query(`
  SELECT phase_id, status, COUNT(*)::int AS n
  FROM phase_coverage
  GROUP BY phase_id, status
  ORDER BY phase_id, status
`);
console.log("=== phase_coverage by status ===");
console.table(cov.rows);

const blocked = await c.query(`
  SELECT COUNT(*)::int AS llm_pending_blocked
  FROM phase_coverage llm
  WHERE llm.phase_id = 'llm' AND llm.status = 'pending'
  AND EXISTS (
    SELECT 1 FROM phase_coverage cat
    WHERE cat.raw_message_id = llm.raw_message_id
      AND cat.phase_id = 'catalog'
      AND cat.status <> 'done'
  )
`);
const ready = await c.query(`
  SELECT COUNT(*)::int AS llm_pending_ready
  FROM phase_coverage llm
  WHERE llm.phase_id = 'llm' AND llm.status = 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM phase_coverage cat
    WHERE cat.raw_message_id = llm.raw_message_id
      AND cat.phase_id = 'catalog'
      AND cat.status <> 'done'
  )
`);
console.log("=== llm pending: blocked vs ready ===");
console.log(blocked.rows[0], ready.rows[0]);

const proc = await c.query(
  "SELECT COUNT(*)::int AS n FROM phase_coverage WHERE phase_id='llm' AND status='processing'",
);
console.log("llm processing:", proc.rows[0]);

const runs = await c.query(`
  SELECT status, COUNT(*)::int AS n, MAX(started_at) AS last_started
  FROM phase_runs WHERE phase_id='llm'
  GROUP BY status ORDER BY status
`);
console.log("=== phase_runs llm ===");
console.table(runs.rows);

const lastRuns = await c.query(`
  SELECT id, status, stats, error, started_at, finished_at, created_at
  FROM phase_runs WHERE phase_id='llm'
  ORDER BY created_at DESC LIMIT 8
`);
console.log("=== last llm runs ===");
for (const r of lastRuns.rows) {
  console.log(
    r.status,
    "started",
    r.started_at,
    "stats",
    JSON.stringify(r.stats),
    r.error ? `err=${r.error.slice(0, 120)}` : "",
  );
}

const noCat = await c.query(`
  SELECT COUNT(*)::int AS n
  FROM phase_coverage llm
  WHERE llm.phase_id = 'llm'
  AND NOT EXISTS (
    SELECT 1 FROM phase_coverage cat
    WHERE cat.raw_message_id = llm.raw_message_id AND cat.phase_id = 'catalog'
  )
`);
console.log("llm rows without catalog coverage:", noCat.rows[0]);

const sample = await c.query(`
  SELECT llm.raw_message_id, cat.status AS catalog_status, llm.status AS llm_status
  FROM phase_coverage llm
  LEFT JOIN phase_coverage cat ON cat.raw_message_id = llm.raw_message_id AND cat.phase_id = 'catalog'
  WHERE llm.phase_id = 'llm' AND llm.status IN ('pending', 'processing')
  ORDER BY llm.created_at ASC
  LIMIT 10
`);
console.log("=== sample llm queue ===");
console.table(sample.rows);

const catalogDoneNoLlm = await c.query(`
  SELECT COUNT(*)::int AS n
  FROM phase_coverage cat
  WHERE cat.phase_id = 'catalog' AND cat.status = 'done'
  AND NOT EXISTS (
    SELECT 1 FROM phase_coverage llm
    WHERE llm.raw_message_id = cat.raw_message_id AND llm.phase_id = 'llm' AND llm.status = 'done'
  )
`);
console.log("catalog done but llm not done:", catalogDoneNoLlm.rows[0]);

await c.end();
