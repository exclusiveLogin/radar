/**
 * Анализ РЕАЛЬНОЙ кинематики угроз за окно: как фактически движутся точки
 * vs дефолты профиля. Цель — найти расхождения формул/настроек с данными.
 *
 * Не строит треки — характеризует данные:
 *  - распределение precision (точность гео → R Kalman)
 *  - реальные дистанции / гэпы / скорости между последовательными точками
 *  - доля «нулевых» переходов (один centroid) → почему нет линий
 *  - сколько пар обрезает maxGap / maxLinkDistance / maxVelocity профиля
 *
 * Примеры:
 *   npm run tracking:kinematics -w @radar/worker
 *   npm run tracking:kinematics -w @radar/worker -- --profile=uav --hours=24
 *   npm run tracking:kinematics -w @radar/worker -- --hours=72 --near-km=15
 */
import { MONOREPO_ROOT } from "@repo/root";
import {
  PROFILE_KINEMATICS,
  haversineDistanceM,
  resolveProfileKinematics,
  stdbscanDedup,
  trackingPipelineConfigSchema,
  type ProfileKinematics,
  type ThreatProfile,
  type TrackingCandidate,
} from "@radar/shared";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { loadTrackingCandidates } from "../application/tracking/loadTrackingCandidates.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { cliWorkerRuntime } from "./cliWorkerRuntime.js";
import { parseLongFlagsMap, readStringFlag } from "./workerCliArgs.js";

type Transition = {
  distM: number;
  gapMs: number;
  velocityMs: number;
  fromName: string;
  toName: string;
  /** Δ дистанции до фронта (км): >0 — вглубь страны (тыл), <0 — к фронту (обратный ток). */
  frontDeltaKm: number | null;
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

function fmtKm(m: number): string {
  return (m / 1000).toFixed(1);
}

function fmtH(ms: number): string {
  return (ms / 3_600_000).toFixed(2);
}

function histogram(values: number[], buckets: { label: string; max: number }[]): void {
  const counts = buckets.map(() => 0);
  let overflow = 0;
  for (const v of values) {
    const idx = buckets.findIndex(b => v <= b.max);
    if (idx === -1) overflow++;
    else counts[idx]++;
  }
  const total = values.length || 1;
  for (let i = 0; i < buckets.length; i++) {
    const pct = ((counts[i]! / total) * 100).toFixed(1);
    const bar = "█".repeat(Math.round((counts[i]! / total) * 40));
    console.log(`  ${buckets[i]!.label.padEnd(14)} ${String(counts[i]).padStart(5)} ${pct.padStart(5)}%  ${bar}`);
  }
  if (overflow > 0) {
    const pct = ((overflow / total) * 100).toFixed(1);
    console.log(`  ${">max".padEnd(14)} ${String(overflow).padStart(5)} ${pct.padStart(5)}%`);
  }
}

/** Последовательные по времени переходы внутри пространственной окрестности near-km. */
function buildTransitions(
  sorted: TrackingCandidate[],
  nearM: number,
  maxGapMs: number,
): Transition[] {
  const transitions: Transition[] = [];
  // Жадно: для каждой точки ищем ближайшую следующую по времени в пределах nearM.
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      const gapMs = b.occurredAt.getTime() - a.occurredAt.getTime();
      if (gapMs <= 0) continue;
      if (gapMs > maxGapMs) break; // отсортировано по времени
      const distM = haversineDistanceM(a.lat, a.lon, b.lat, b.lon);
      if (distM > nearM) continue;
      const frontDeltaKm =
        a.frontDistanceKm != null && b.frontDistanceKm != null
          ? b.frontDistanceKm - a.frontDistanceKm
          : null;
      transitions.push({
        distM,
        gapMs,
        velocityMs: gapMs > 0 ? distM / (gapMs / 1000) : 0,
        fromName: a.placeId ?? `${a.lat.toFixed(2)},${a.lon.toFixed(2)}`,
        toName: b.placeId ?? `${b.lat.toFixed(2)},${b.lon.toFixed(2)}`,
        frontDeltaKm,
      });
      break; // ближайшая по времени — следующая
    }
  }
  return transitions;
}

function analyzeProfile(
  profile: ThreatProfile,
  candidates: TrackingCandidate[],
  kin: ProfileKinematics,
  nearM: number,
): void {
  const profileCands = candidates.filter(c => c.threatProfile === profile);
  console.log(`\n${"=".repeat(70)}`);
  console.log(`ПРОФИЛЬ: ${profile}  | точек: ${profileCands.length}`);
  console.log("=".repeat(70));
  if (profileCands.length < 2) {
    console.log("Мало точек для анализа.");
    return;
  }

  // precision distribution
  const byPrecision = new Map<string, number>();
  const uniqueCoords = new Set<string>();
  for (const c of profileCands) {
    byPrecision.set(c.precision, (byPrecision.get(c.precision) ?? 0) + 1);
    uniqueCoords.add(`${c.lat.toFixed(4)},${c.lon.toFixed(4)}`);
  }
  console.log(`\nPrecision (→ σ Kalman R):`);
  for (const [p, n] of [...byPrecision.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${p.padEnd(22)} ${String(n).padStart(5)}`);
  }
  console.log(`Уникальных координат: ${uniqueCoords.size} из ${profileCands.length} (одинаковых centroid → нет движения)`);

  // ST-DBSCAN эффект
  const { deduplicated, collapsedCount } = stdbscanDedup(profileCands, {
    epsilonSpatialM: kin.stdbscanEpsilonSpatialM,
    epsilonTemporalMs: kin.stdbscanEpsilonTemporalMs,
    minPts: kin.stdbscanMinPts,
  });
  console.log(
    `\nST-DBSCAN: ${profileCands.length} → ${deduplicated.length} (схлопнуто ${collapsedCount}, eps=${fmtKm(kin.stdbscanEpsilonSpatialM)}км/${kin.stdbscanEpsilonTemporalMs / 60000}мин)`,
  );

  const sorted = [...deduplicated].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const transitions = buildTransitions(sorted, nearM, kin.maxGapMs);
  console.log(`\nПереходы (последовательные точки в пределах ${fmtKm(nearM)}км, gap≤${fmtH(kin.maxGapMs)}ч): ${transitions.length}`);
  if (transitions.length === 0) {
    console.log("Нет связных переходов — точки изолированы по времени/пространству.");
    return;
  }

  const dists = transitions.map(t => t.distM).sort((a, b) => a - b);
  const gaps = transitions.map(t => t.gapMs).sort((a, b) => a - b);
  const zeroMoves = transitions.filter(t => t.distM < 100).length;

  console.log(`\nДистанция между точками (км):  p50=${fmtKm(percentile(dists, 50))} p90=${fmtKm(percentile(dists, 90))} max=${fmtKm(dists[dists.length - 1]!)}`);
  histogram(dists, [
    { label: "0 (тот же)", max: 100 },
    { label: "<5км", max: 5000 },
    { label: "5-20км", max: 20000 },
    { label: "20-50км", max: 50000 },
    { label: "50-100км", max: 100000 },
    { label: "100-250км", max: 250000 },
  ]);
  console.log(`  Нулевых переходов (<100м, один centroid): ${zeroMoves} (${((zeroMoves / transitions.length) * 100).toFixed(1)}%)`);

  console.log(`\nВременной gap (ч):  p50=${fmtH(percentile(gaps, 50))} p90=${fmtH(percentile(gaps, 90))} max=${fmtH(gaps[gaps.length - 1]!)}`);
  histogram(gaps, [
    { label: "<15мин", max: 15 * 60000 },
    { label: "15-60мин", max: 60 * 60000 },
    { label: "1-2ч", max: 2 * 3600000 },
    { label: "2-4ч", max: 4 * 3600000 },
  ]);

  const movingVels = transitions.filter(t => t.distM >= 100).map(t => t.velocityMs).sort((a, b) => a - b);
  console.log(`\nСкорость движущихся переходов (м/с, profile max=${kin.maxVelocityMs}):`);
  if (movingVels.length === 0) {
    console.log("  Нет движущихся переходов (всё стационарно).");
  } else {
    console.log(`  p50=${percentile(movingVels, 50).toFixed(1)} p90=${percentile(movingVels, 90).toFixed(1)} max=${movingVels[movingVels.length - 1]!.toFixed(1)}`);
    const overMax = movingVels.filter(v => v > kin.maxVelocityMs).length;
    console.log(`  Превышают maxVelocityMs (${kin.maxVelocityMs}): ${overMax} (${((overMax / movingVels.length) * 100).toFixed(1)}%) → gate отрежет`);
  }

  // Направленность: фронт→тыл (гипотеза) vs обратный ток
  const directed = transitions.filter(t => t.frontDeltaKm != null && t.distM >= 100);
  console.log(`\nНаправление потока (Δ дистанции до фронта, движущиеся переходы):`);
  if (directed.length === 0) {
    console.log("  Нет данных front_distance_km — заполни regions.front_distance_km (geo-sync/seed).");
  } else {
    const inward = directed.filter(t => t.frontDeltaKm! > 5).length; // вглубь
    const outward = directed.filter(t => t.frontDeltaKm! < -5).length; // к фронту
    const lateral = directed.length - inward - outward;
    const deltas = directed.map(t => t.frontDeltaKm!).sort((a, b) => a - b);
    const pct = (n: number) => ((n / directed.length) * 100).toFixed(1);
    console.log(`  Вглубь (тыл, Δ>+5км):   ${String(inward).padStart(4)} (${pct(inward)}%)`);
    console.log(`  К фронту (Δ<−5км):      ${String(outward).padStart(4)} (${pct(outward)}%) ← обратный ток`);
    console.log(`  Вдоль (|Δ|≤5км):        ${String(lateral).padStart(4)} (${pct(lateral)}%)`);
    console.log(`  Медиана Δ: ${percentile(deltas, 50).toFixed(1)}км (p10=${percentile(deltas, 10).toFixed(1)} p90=${percentile(deltas, 90).toFixed(1)})`);
    if (inward > outward * 1.5) {
      console.log("  ✓ Гипотеза «фронт→тыл» подтверждается: преобладает движение вглубь.");
    } else if (outward > inward) {
      console.log("  ⚠ Преобладает обратный ток — проверь seed (фронт) и rear-front gate.");
    }
  }

  // Диагноз
  console.log(`\n--- Диагноз ---`);
  const overLink = dists.filter(d => d > kin.maxLinkDistanceM).length;
  if (zeroMoves / transitions.length > 0.7) {
    console.log("⚠ Большинство переходов нулевые: гео привязано к centroid места → треки стационарны, линий не будет.");
  }
  if (overLink > 0) {
    console.log(`⚠ ${overLink} переходов > maxLinkDistanceM (${fmtKm(kin.maxLinkDistanceM)}км) → разрыв цепи.`);
  }
  if (percentile(dists, 90) < kin.stdbscanEpsilonSpatialM) {
    console.log(`⚠ p90 дистанции (${fmtKm(percentile(dists, 90))}км) < ST-DBSCAN eps (${fmtKm(kin.stdbscanEpsilonSpatialM)}км) → dedup схлопывает реальные переходы в одну точку!`);
  }
}

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const flags = parseLongFlagsMap(process.argv);
  const profileFilter = readStringFlag(flags, ["profile"]) as ThreatProfile | undefined;
  const hours = Number(readStringFlag(flags, ["hours"]) ?? "24");
  const nearKm = Number(readStringFlag(flags, ["near-km"]) ?? "250");

  const runtime = await createWorkerCompositionRoot(cliWorkerRuntime("tracking", ["tracking"]));
  const ds = runtime.dataSource;
  if (!ds) {
    console.error("Нужен RADAR_STORAGE_MODE=db");
    process.exit(1);
  }

  try {
    const [stateRow] = await ds.query<{ config: unknown }[]>(
      `SELECT config FROM state_track_pipeline WHERE id = 'default'`,
    );
    const config = trackingPipelineConfigSchema.parse(stateRow?.config ?? {});

    const until = new Date();
    const since = new Date(until.getTime() - hours * 3_600_000);
    const raw = await loadTrackingCandidates(ds, { since, until, excludeConsumed: false });
    // pg отдаёт numeric как string — приводим к числам для гео-расчётов.
    const candidates: TrackingCandidate[] = raw.map(c => ({
      ...c,
      lat: Number(c.lat),
      lon: Number(c.lon),
      occurredAt: c.occurredAt instanceof Date ? c.occurredAt : new Date(c.occurredAt),
    }));

    console.log(`\nОкно: последние ${hours}ч | всего кандидатов: ${candidates.length} | near=${nearKm}км`);

    const profiles = profileFilter
      ? [profileFilter]
      : (Object.keys(PROFILE_KINEMATICS) as ThreatProfile[]);

    for (const profile of profiles) {
      const kin = resolveProfileKinematics(profile, config.profiles);
      analyzeProfile(profile, candidates, kin, nearKm * 1000);
    }
  } finally {
    await runtime.shutdown?.();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
