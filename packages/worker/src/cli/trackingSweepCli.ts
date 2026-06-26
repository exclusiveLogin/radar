/**
 * Offline sweep параметров трекинга на реальных кандидатах из БД.
 *
 * Цель: понять, при каких chi2 / processNoise / seedMin / maxGap собираются цепочки >1 ноды.
 *
 * Примеры:
 *   npm run tracking:sweep -w @radar/worker
 *   npm run tracking:sweep -w @radar/worker -- --profile=uav --days=30 --limit=1500
 *   npm run tracking:sweep -w @radar/worker -- --chi2=10,15,20,25,30,40,60,90
 *   npm run tracking:sweep -w @radar/worker -- --noise=0.3,0.6,0.8,1.2,2,3
 *   npm run tracking:sweep -w @radar/worker -- --seed=0.2,0.35,0.45,0.6
 */
import { MONOREPO_ROOT } from "@repo/root";
import {
  DEFAULT_SEED_MIN,
  resolveProfileKinematics,
  trackingPipelineConfigSchema,
  tuneCenterFromProfile,
  tuneCenterToProfilePatch,
  type ThreatProfile,
  type TrackingCandidate,
  type TuneCenter,
} from "@radar/shared";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { loadTrackingCandidates } from "../application/tracking/loadTrackingCandidates.js";
import { buildMutableTracks } from "../application/tracking/trackingRebuildService.js";
import { evaluateTuneCenter } from "../application/tracking/trackingTuneRunner.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { parseLongFlagsMap, readStringFlag } from "./workerCliArgs.js";

type SweepRow = {
  label: string;
  chi2: number;
  noise: number;
  seedMin: number;
  maxGapH: number;
  chains: number;
  maxLen: number;
  ge2: number;
  ge3: number;
  moving: number;
  coverage: string;
  fitness: number;
};

function parseNumList(raw: string | undefined, fallback: number[]): number[] {
  if (!raw) return fallback;
  return raw.split(",").map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0);
}

function summarizeChains(
  candidates: TrackingCandidate[],
  profile: ThreatProfile,
  center: TuneCenter,
  rebuildAt: Date,
) {
  const kin = resolveProfileKinematics(profile, {
    [profile]: tuneCenterToProfilePatch(center),
  });
  const profileCands = candidates.filter(c => c.threatProfile === profile);
  const tracks = buildMutableTracks(profileCands, kin, rebuildAt, center.seedMin);
  const chains = tracks.filter(t => t.nodes.length >= 2);
  let moving = 0;
  for (const t of chains) {
    const first = t.nodes[0]!;
    if (t.nodes.some((n, i) => i > 0 && (n.lat !== first.lat || n.lon !== first.lon))) moving++;
  }
  const lens = chains.map(t => t.nodes.length);
  const inTracks = lens.reduce((a, b) => a + b, 0);
  const deduped = profileCands.length;
  return {
    chains: chains.length,
    ge2: lens.filter(l => l >= 2).length,
    ge3: lens.filter(l => l >= 3).length,
    maxLen: lens.length ? Math.max(...lens) : 0,
    moving,
    coverage: deduped > 0 ? ((inTracks / deduped) * 100).toFixed(1) : "0.0",
  };
}

async function loadPipelineCenter(
  ds: Awaited<ReturnType<typeof createWorkerCompositionRoot>>["dataSource"],
  profile: ThreatProfile,
): Promise<TuneCenter> {
  const [row] = await ds!.query<{ config: unknown }[]>(
    `SELECT config FROM tracking_pipeline_state WHERE id = 'default'`,
  );
  const config = trackingPipelineConfigSchema.parse(row?.config ?? {});
  const kin = resolveProfileKinematics(profile, config.profiles);
  return tuneCenterFromProfile(kin, config.seedMin ?? DEFAULT_SEED_MIN);
}

function printTable(rows: SweepRow[]): void {
  const header =
    "label".padEnd(14)
    + "chi2".padStart(6)
    + "noise".padStart(7)
    + "seed".padStart(6)
    + "gapH".padStart(6)
    + "chains".padStart(7)
    + "max".padStart(5)
    + "≥3".padStart(5)
    + "mov".padStart(5)
    + "cov%".padStart(7)
    + "fit".padStart(8);
  console.log(header);
  console.log("-".repeat(header.length));
  for (const r of rows) {
    console.log(
      r.label.padEnd(14)
      + String(r.chi2).padStart(6)
      + r.noise.toFixed(2).padStart(7)
      + r.seedMin.toFixed(2).padStart(6)
      + r.maxGapH.toFixed(1).padStart(6)
      + String(r.chains).padStart(7)
      + String(r.maxLen).padStart(5)
      + String(r.ge3).padStart(5)
      + String(r.moving).padStart(5)
      + r.coverage.padStart(7)
      + r.fitness.toFixed(3).padStart(8),
    );
  }
}

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const flags = parseLongFlagsMap(process.argv);
  const profile = (readStringFlag(flags, ["profile"]) ?? "uav") as ThreatProfile;
  const days = Number(readStringFlag(flags, ["days"]) ?? "30");
  const sampleLimit = Number(readStringFlag(flags, ["limit"]) ?? "2000");

  const chi2List = parseNumList(readStringFlag(flags, ["chi2"]), [
    6, 9, 12, 15, 20, 25, 30, 40, 60, 90, 120,
  ]);
  const noiseList = parseNumList(readStringFlag(flags, ["noise"]), [
    0.3, 0.5, 0.8, 1.0, 1.5, 2.0, 3.0, 4.0,
  ]);
  const seedList = parseNumList(readStringFlag(flags, ["seed"]), [0.25, 0.35, 0.45, 0.55]);

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
    const until = new Date();
    const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);
    let candidates = await loadTrackingCandidates(ds, {
      since,
      until,
      excludeConsumed: false,
    });

    const totalLoaded = candidates.length;
    const byProfile = candidates.filter(c => c.threatProfile === profile);
    if (byProfile.length > sampleLimit) {
      const step = Math.floor(byProfile.length / sampleLimit);
      const sampled = byProfile.filter((_, i) => i % step === 0).slice(0, sampleLimit);
      const others = candidates.filter(c => c.threatProfile !== profile);
      candidates = [...others, ...sampled];
    }

    console.log(`\n=== Tracking sweep: profile=${profile}, window=${days}d ===`);
    console.log(`Кандидатов всего: ${totalLoaded}, профиль ${profile}: ${byProfile.length}`);
    if (byProfile.length < 10) {
      console.error("Мало кандидатов для профиля — расширь --days или проверь parse/geo.");
      process.exit(1);
    }

    const center = await loadPipelineCenter(ds, profile);
    const centerGapH = center.maxGapMs / 3_600_000;
    const gapHoursList = parseNumList(readStringFlag(flags, ["gap-hours"]), [centerGapH]);
    console.log(
      `\nЦентр (текущие настройки): chi2=${center.chi2Threshold}, noise=${center.processNoiseScale}, seed=${center.seedMin}, maxGapMs=${center.maxGapMs}`,
    );

    const baseline = summarizeChains(candidates, profile, center, until);
    const baseFitness = evaluateTuneCenter(candidates, profile, center, until);
    console.log(
      `Baseline: chains=${baseline.chains}, maxLen=${baseline.maxLen}, ≥3=${baseline.ge3}, moving=${baseline.moving}, cov=${baseline.coverage}%, fitness=${baseFitness.fitness.toFixed(3)}`,
    );

    const rows: SweepRow[] = [];

    for (const chi2 of chi2List) {
      for (const noise of noiseList) {
        for (const seedMin of seedList) {
          for (const gapH of gapHoursList) {
            const probe: TuneCenter = {
              ...center,
              chi2Threshold: chi2,
              processNoiseScale: noise,
              seedMin,
              maxGapMs: gapH * 3_600_000,
            };
            const sum = summarizeChains(candidates, profile, probe, until);
            const fit = evaluateTuneCenter(candidates, profile, probe, until);
            const isCenter =
              chi2 === center.chi2Threshold
              && noise === center.processNoiseScale
              && seedMin === center.seedMin
              && gapH === center.maxGapMs / 3_600_000;
            rows.push({
              label: isCenter ? "*settings*" : "",
              chi2,
              noise,
              seedMin,
              maxGapH: gapH,
              chains: sum.chains,
              maxLen: sum.maxLen,
              ge2: sum.ge2,
              ge3: sum.ge3,
              moving: sum.moving,
              coverage: sum.coverage,
              fitness: fit.fitness,
            });
          }
        }
      }
    }

    rows.sort((a, b) => b.chains - a.chains || b.maxLen - a.maxLen || b.fitness - a.fitness);

    console.log(`\n=== Top по числу цепочек (≥2 нод), grid ${rows.length} комбинаций ===`);
    printTable(rows.slice(0, 20));

    const withChains = rows.filter(r => r.chains > 0);
    console.log(`\nКомбинаций с цепочками ≥2: ${withChains.length} / ${rows.length}`);
    if (withChains.length === 0) {
      console.log(
        "Ни одна комбинация не собрала цепочку — вероятно все точки в одном месте или maxGap слишком мал.",
      );
    }

    const best = rows[0];
    if (best && best.chains > baseline.chains) {
      console.log(
        `\nЛучше baseline: chi2=${best.chi2}, noise=${best.noise}, seed=${best.seedMin}, gapH=${best.maxGapH} → chains=${best.chains}, maxLen=${best.maxLen}`,
      );
    }
  } finally {
    await runtime.shutdown?.();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
