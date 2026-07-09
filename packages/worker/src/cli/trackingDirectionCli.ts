/**
 * Анализ направления ПОСТРОЕННЫХ треков: фронт→тыл (гипотеза) vs обратный ток.
 *
 * Для каждой ноды берём front_distance_km её региона
 * (source_refs[].eventLocationId → mat_parse_location → regions.front_distance_km).
 * Δ вдоль seq: >0 — вглубь страны (тыл), <0 — к фронту (обратка).
 *
 * Примеры:
 *   npm run tracking:direction -w @radar/worker
 *   npm run tracking:direction -w @radar/worker -- --profile=uav --top=15
 */
import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { parseLongFlagsMap, readStringFlag } from "./workerCliArgs.js";

type TrackDirRow = {
  track_id: string;
  threat_profile: string;
  first_front: number | null;
  last_front: number | null;
  steps: string;
  reverse_steps: string;
  forward_steps: string;
};

/** Порог значимого шага по дистанции до фронта (км). */
const STEP_EPS_KM = 5;

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const flags = parseLongFlagsMap(process.argv);
  const profile = readStringFlag(flags, ["profile"]);
  const top = Number(readStringFlag(flags, ["top"]) ?? "15");

  const runtime = await createWorkerCompositionRoot({
    storageMode: WorkerStorageMode.Db,
    startIngestParseDaemon: false,
  });
  const ds = runtime.dataSource;
  if (!ds) {
    console.error("Нужен RADAR_STORAGE_MODE=db");
    process.exit(1);
  }

  try {
    const rows = await ds.query<TrackDirRow[]>(
      `
      WITH node_front AS (
        SELECT
          tn.track_id,
          tt.threat_profile,
          tn.seq,
          r.front_distance_km
        FROM mat_track_node tn
        JOIN mat_track tt ON tt.id = tn.track_id
        LEFT JOIN LATERAL (
          SELECT (ref->>'eventLocationId')::uuid AS elid
          FROM jsonb_array_elements(tn.source_refs) ref
          WHERE ref->>'eventLocationId' ~ '^[0-9a-f-]{36}$'
          LIMIT 1
        ) sr ON true
        LEFT JOIN mat_parse_location el ON el.id = sr.elid
        LEFT JOIN regions r ON r.id = el.region_id
        ${profile ? "WHERE tt.threat_profile = $1" : ""}
      ),
      seg AS (
        SELECT
          track_id,
          threat_profile,
          seq,
          front_distance_km,
          front_distance_km - lag(front_distance_km) OVER w AS d,
          first_value(front_distance_km) OVER w AS first_front,
          last_value(front_distance_km) OVER (
            PARTITION BY track_id ORDER BY seq
            ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
          ) AS last_front
        FROM node_front
        WINDOW w AS (PARTITION BY track_id ORDER BY seq)
      )
      SELECT
        track_id,
        threat_profile,
        max(first_front) AS first_front,
        max(last_front)  AS last_front,
        count(d)::text AS steps,
        count(*) FILTER (WHERE d < -${STEP_EPS_KM})::text AS reverse_steps,
        count(*) FILTER (WHERE d >  ${STEP_EPS_KM})::text AS forward_steps
      FROM seg
      GROUP BY track_id, threat_profile
      `,
      profile ? [profile] : [],
    );

    const withData = rows.filter(r => Number(r.steps) > 0);
    console.log(`\nТреков всего: ${rows.length} | с front_distance_km: ${withData.length}`);
    if (withData.length === 0) {
      console.log("Нет front_distance_km — заполни regions.front_distance_km (geo-sync/seed).");
      return;
    }

    let totalSteps = 0;
    let totalReverse = 0;
    let totalForward = 0;
    let netInward = 0;
    let netReverse = 0;
    let netFlat = 0;

    for (const r of withData) {
      const steps = Number(r.steps);
      const rev = Number(r.reverse_steps);
      const fwd = Number(r.forward_steps);
      totalSteps += steps;
      totalReverse += rev;
      totalForward += fwd;
      const net = (r.last_front ?? 0) - (r.first_front ?? 0);
      if (net > STEP_EPS_KM) netInward++;
      else if (net < -STEP_EPS_KM) netReverse++;
      else netFlat++;
    }

    const pct = (n: number, d: number) => (d > 0 ? ((n / d) * 100).toFixed(1) : "0.0");

    console.log(`\n=== Сегменты (шаги между нодами) ===`);
    console.log(`  Вперёд (вглубь, Δ>+${STEP_EPS_KM}км): ${totalForward} (${pct(totalForward, totalSteps)}%)`);
    console.log(`  Назад (к фронту, Δ<−${STEP_EPS_KM}км):  ${totalReverse} (${pct(totalReverse, totalSteps)}%) ← обратка`);
    console.log(`  Всего шагов: ${totalSteps}`);

    console.log(`\n=== Треки по нетто-направлению (первая→последняя нода) ===`);
    console.log(`  Вглубь (тыл):   ${netInward} (${pct(netInward, withData.length)}%)`);
    console.log(`  В обратку:      ${netReverse} (${pct(netReverse, withData.length)}%)`);
    console.log(`  Плоско:         ${netFlat} (${pct(netFlat, withData.length)}%)`);

    const worst = withData
      .map(r => ({
        id: r.track_id,
        profile: r.threat_profile,
        net: (r.last_front ?? 0) - (r.first_front ?? 0),
        revFrac: Number(r.reverse_steps) / Math.max(1, Number(r.steps)),
        first: r.first_front,
        last: r.last_front,
        steps: Number(r.steps),
      }))
      .filter(t => t.net < -STEP_EPS_KM || t.revFrac > 0.4)
      .sort((a, b) => a.net - b.net)
      .slice(0, top);

    if (worst.length > 0) {
      console.log(`\n=== Топ обратных треков (net вглубь<0 или >40% шагов назад) ===`);
      for (const t of worst) {
        console.log(
          `  ${t.id.slice(0, 8)} [${t.profile}] net=${t.net.toFixed(0)}км ` +
            `front ${t.first?.toFixed(0)}→${t.last?.toFixed(0)}км ` +
            `назад ${(t.revFrac * 100).toFixed(0)}% (${t.steps} шаг.)`,
        );
      }
    }
  } finally {
    await runtime.shutdown?.();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
