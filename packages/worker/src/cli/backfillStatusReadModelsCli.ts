import { MONOREPO_ROOT } from "@repo/root";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { createWorkerDataSource } from "../infrastructure/persistence/createWorkerDataSource.js";

/**
 * Реиндексация read-model LastWinner из существующих event_locations.
 */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const dataSource = await createWorkerDataSource();

  await dataSource.query(`TRUNCATE TABLE place_status_read_model`);
  await dataSource.query(`TRUNCATE TABLE region_status_read_model`);

  await dataSource.query(
    `
    WITH normalized AS (
      SELECT
        el.id,
        el.region_id,
        r.iso AS region_code,
        el.place_id,
        COALESCE(el.status_code, pe.event_type) AS status_code,
        sd.state_level,
        COALESCE(
          el.action,
          CASE WHEN pe.event_type = 'cleared' OR pe.is_active = false THEN 'clear' ELSE 'raise' END
        ) AS action,
        COALESCE(el.author_channel_key, c.key) AS author_channel_key,
        COALESCE(el.occurred_at, rm.posted_at, pe.parsed_at, now()) AS occurred_at
      FROM event_locations el
      JOIN parsed_events pe ON pe.id = el.parsed_event_id
      JOIN raw_messages rm ON rm.id = pe.raw_message_id
      JOIN channels c ON c.id = rm.channel_id
      JOIN regions r ON r.id = el.region_id
      LEFT JOIN status_dictionary sd ON sd.code = COALESCE(el.status_code, pe.event_type) AND sd.is_active = true
    ),
    ranked_region AS (
      SELECT *,
             ROW_NUMBER() OVER (PARTITION BY region_id ORDER BY occurred_at DESC, id DESC) AS rn
      FROM normalized
    )
    INSERT INTO region_status_read_model(
      region_id, region_code, status_code, state_level, action, author_channel_key,
      winner_event_location_id, winner_occurred_at, stale, stale_at, updated_at
    )
    SELECT
      region_id,
      COALESCE(region_code, ''),
      status_code,
      COALESCE(state_level, 'grey'),
      action,
      author_channel_key,
      id,
      occurred_at,
      false,
      NULL,
      now()
    FROM ranked_region
    WHERE rn = 1
    `,
  );

  await dataSource.query(
    `
    WITH normalized AS (
      SELECT
        el.id,
        el.place_id,
        el.region_id,
        COALESCE(el.status_code, pe.event_type) AS status_code,
        sd.state_level,
        COALESCE(
          el.action,
          CASE WHEN pe.event_type = 'cleared' OR pe.is_active = false THEN 'clear' ELSE 'raise' END
        ) AS action,
        COALESCE(el.author_channel_key, c.key) AS author_channel_key,
        COALESCE(el.occurred_at, rm.posted_at, pe.parsed_at, now()) AS occurred_at
      FROM event_locations el
      JOIN parsed_events pe ON pe.id = el.parsed_event_id
      JOIN raw_messages rm ON rm.id = pe.raw_message_id
      JOIN channels c ON c.id = rm.channel_id
      LEFT JOIN status_dictionary sd ON sd.code = COALESCE(el.status_code, pe.event_type) AND sd.is_active = true
      WHERE el.place_id IS NOT NULL
    ),
    ranked_place AS (
      SELECT *,
             ROW_NUMBER() OVER (PARTITION BY place_id ORDER BY occurred_at DESC, id DESC) AS rn
      FROM normalized
    )
    INSERT INTO place_status_read_model(
      place_id, region_id, status_code, state_level, action, author_channel_key,
      winner_event_location_id, winner_occurred_at, stale, stale_at, updated_at
    )
    SELECT
      place_id,
      region_id,
      status_code,
      COALESCE(state_level, 'grey'),
      action,
      author_channel_key,
      id,
      occurred_at,
      false,
      NULL,
      now()
    FROM ranked_place
    WHERE rn = 1
    `,
  );

  const regionRows = (await dataSource.query(
    `SELECT COUNT(*)::int AS c FROM region_status_read_model`,
  )) as Array<{ c: number }>;
  const placeRows = (await dataSource.query(
    `SELECT COUNT(*)::int AS c FROM place_status_read_model`,
  )) as Array<{ c: number }>;
  console.log(
    `Backfill LastWinner read-model done: regions=${regionRows[0]?.c ?? 0}, places=${placeRows[0]?.c ?? 0}`,
  );

  await dataSource.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
