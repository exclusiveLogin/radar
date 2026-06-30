/**
 * Offline auto-tune: pattern search по срезу event_locations из БД.
 */
import type { DataSource } from "typeorm";
import {
  DEFAULT_SEED_MIN,
  computeTrackingFitness,
  defaultTuneAxes,
  haversineDistanceM,
  patternSearchStep,
  probeCenter,
  resolveProfileKinematics,
  stdbscanDedup,
  trackingPipelineConfigSchema,
  trackingTuneStartRequestSchema,
  tuneCenterFromProfile,
  tuneCenterToProfilePatch,
  type ProfileKinematics,
  type ThreatProfile,
  type TrackingCandidate,
  type TuneCenter,
} from "@radar/shared";
import { loadTrackingCandidates } from "./loadTrackingCandidates.js";
import { buildMutableTracks } from "./trackingRebuildService.js";

/** Chi²: от широкого круга (×12) до узкого вектора (×0.15) относительно центра в настройках. */
const CHI2_MIN_FACTOR = 0.15;
const CHI2_MAX_FACTOR = 12;
/** Остальные оси — умеренный коридор вокруг текущего центра. */
const AXIS_MIN_FACTOR = 0.25;
const AXIS_MAX_FACTOR = 4;

/** Клампит probe относительно стартового центра (текущие настройки профиля). */
function clampCenter(center: TuneCenter, initial: TuneCenter): TuneCenter {
  const clamp = (v: number, ref: number, minF: number, maxF: number) =>
    Math.min(ref * maxF, Math.max(ref * minF, v));
  return {
    chi2Threshold: clamp(center.chi2Threshold, initial.chi2Threshold, CHI2_MIN_FACTOR, CHI2_MAX_FACTOR),
    processNoiseScale: clamp(
      center.processNoiseScale,
      initial.processNoiseScale,
      AXIS_MIN_FACTOR,
      AXIS_MAX_FACTOR,
    ),
    seedMin: Math.max(0.05, center.seedMin),
    maxGapMs: clamp(center.maxGapMs, initial.maxGapMs, AXIS_MIN_FACTOR, AXIS_MAX_FACTOR),
    rearThresholdM: clamp(center.rearThresholdM, initial.rearThresholdM, AXIS_MIN_FACTOR, AXIS_MAX_FACTOR),
  };
}

const TUNE_WINDOW_DAYS = 30;
const DEFAULT_SAMPLE_LIMIT = 2000;

type TuneRunRow = {
  id: string;
  status: string;
  params_in: Record<string, unknown>;
  epochs_done: number;
  max_epochs: number;
  best_config: Record<string, unknown> | null;
  best_fitness: number | null;
  grid: Record<string, unknown>[];
  control: { cancel?: boolean } | null;
};

type SimResult = {
  /** Длины цепочек (>=2 нод) после Kalman-движка. */
  trackLengths: number[];
  /** Средняя нормированная дистанция линков внутри цепочек — proxy contamination. */
  meanNormLinkDist: number;
  /** Число точек после ST-DBSCAN dedup — знаменатель coverage. */
  deduped: number;
};

/**
 * Прогон того же Kalman-движка, что и прод rebuild (SSOT buildMutableTracks):
 * chi2/processNoise/rear реально влияют на линковку, поэтому fitness-ландшафт
 * не вырожден и отражает продакшен.
 */
function simulateAssign(
  candidates: TrackingCandidate[],
  kin: ProfileKinematics,
  seedMin: number,
  rebuildAt: Date,
): SimResult {
  const { deduplicated } = stdbscanDedup(candidates, {
    epsilonSpatialM: kin.stdbscanEpsilonSpatialM,
    epsilonTemporalMs: kin.stdbscanEpsilonTemporalMs,
    minPts: kin.stdbscanMinPts,
  });
  const { tracks } = buildMutableTracks(deduplicated, kin, rebuildAt, seedMin);

  const trackLengths: number[] = [];
  let linkDistSum = 0;
  let linkCount = 0;
  for (const t of tracks) {
    if (t.nodes.length < 2) continue;
    trackLengths.push(t.nodes.length);
    for (let i = 1; i < t.nodes.length; i++) {
      const prev = t.nodes[i - 1]!;
      const cur = t.nodes[i]!;
      linkDistSum += haversineDistanceM(cur.lat, cur.lon, prev.lat, prev.lon) / kin.maxLinkDistanceM;
      linkCount += 1;
    }
  }

  return {
    trackLengths,
    meanNormLinkDist: linkCount > 0 ? linkDistSum / linkCount : 0,
    deduped: deduplicated.length,
  };
}

/** Fitness одного центра на срезе кандидатов профиля. */
export function evaluateTuneCenter(
  candidates: TrackingCandidate[],
  profile: ThreatProfile,
  center: TuneCenter,
  rebuildAt: Date = new Date(),
) {
  const kin = resolveProfileKinematics(profile, {
    [profile]: tuneCenterToProfilePatch(center),
  });
  const profileCands = candidates.filter(c => c.threatProfile === profile);
  const sim = simulateAssign(profileCands, kin, center.seedMin, rebuildAt);
  const inTracks = sim.trackLengths.reduce((a, b) => a + b, 0);
  const orphanCount = Math.max(0, sim.deduped - inTracks);
  return computeTrackingFitness({
    totalPoints: sim.deduped,
    trackLengths: sim.trackLengths,
    meanAcceptDM: sim.meanNormLinkDist,
    orphanCount,
  });
}

function bestConfigForProfile(profile: ThreatProfile, center: TuneCenter): Record<string, unknown> {
  return { profiles: { [profile]: tuneCenterToProfilePatch(center) } };
}

/** Текущий профиль из tracking_pipeline_state (не хардкод PROFILE_KINEMATICS). */
async function loadProfileKinematics(ds: DataSource, profile: ThreatProfile): Promise<ProfileKinematics> {
  const [row] = await ds.query<{ config: unknown }[]>(
    `SELECT config FROM tracking_pipeline_state WHERE id = 'default'`,
  );
  const config = trackingPipelineConfigSchema.parse(row?.config ?? {});
  return resolveProfileKinematics(profile, config.profiles);
}

async function loadSeedMin(ds: DataSource): Promise<number> {
  const [row] = await ds.query<{ config: unknown }[]>(
    `SELECT config FROM tracking_pipeline_state WHERE id = 'default'`,
  );
  const config = trackingPipelineConfigSchema.parse(row?.config ?? {});
  return config.seedMin ?? DEFAULT_SEED_MIN;
}

async function loadRun(ds: DataSource, id: string): Promise<TuneRunRow | null> {
  const [row] = await ds.query<TuneRunRow[]>(
    `SELECT id, status, params_in, epochs_done, max_epochs, best_config, best_fitness, grid, control
     FROM tracking_tune_runs WHERE id = $1`,
    [id],
  );
  return row ?? null;
}

async function isCancelled(ds: DataSource, id: string): Promise<boolean> {
  const row = await loadRun(ds, id);
  if (!row || row.status !== "running") return true;
  return row.control?.cancel === true;
}

async function persistProgress(
  ds: DataSource,
  id: string,
  input: {
    epochsDone: number;
    bestFitness: number;
    bestConfig: Record<string, unknown>;
    grid: Record<string, unknown>[];
  },
): Promise<void> {
  await ds.query(
    `UPDATE tracking_tune_runs
     SET epochs_done = $2, best_fitness = $3, best_config = $4::jsonb, grid = $5::jsonb
     WHERE id = $1 AND status = 'running'`,
    [id, input.epochsDone, input.bestFitness, JSON.stringify(input.bestConfig), JSON.stringify(input.grid)],
  );
}

async function finishRun(
  ds: DataSource,
  id: string,
  input: {
    epochsDone: number;
    bestFitness: number;
    bestConfig: Record<string, unknown>;
    grid: Record<string, unknown>[];
  },
): Promise<void> {
  await ds.query(
    `UPDATE tracking_tune_runs
     SET status = 'done', finished_at = now(), epochs_done = $2, best_fitness = $3,
         best_config = $4::jsonb, grid = $5::jsonb
     WHERE id = $1`,
    [id, input.epochsDone, input.bestFitness, JSON.stringify(input.bestConfig), JSON.stringify(input.grid)],
  );
}

async function failRun(ds: DataSource, id: string, error: string): Promise<void> {
  await ds.query(
    `UPDATE tracking_tune_runs
     SET status = 'failed', error = $2, finished_at = now()
     WHERE id = $1 AND status = 'running'`,
    [id, error.slice(0, 2000)],
  );
}

/** Выполняет один tune job до done / failed / cancel. */
export async function executeTrackingTuneRun(ds: DataSource, runId: string): Promise<void> {
  const run = await loadRun(ds, runId);
  if (!run || run.status !== "running") return;

  const params = trackingTuneStartRequestSchema.parse(run.params_in ?? {});
  const profile = params.profile;
  const sampleLimit = params.sampleLimit ?? DEFAULT_SAMPLE_LIMIT;
  const maxEpochs = run.max_epochs;

  const until = new Date();
  const since = new Date(until.getTime() - TUNE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  let candidates = await loadTrackingCandidates(ds, {
    since,
    until,
    excludeConsumed: false,
  });
  if (candidates.length > sampleLimit) {
    const step = Math.floor(candidates.length / sampleLimit);
    candidates = candidates.filter((_, i) => i % step === 0).slice(0, sampleLimit);
  }

  if (candidates.length < 10) {
    await failRun(ds, runId, `мало кандидатов для tune (${candidates.length}), нужен geo + tracking types`);
    return;
  }

  const kin = await loadProfileKinematics(ds, profile);
  const initialCenter = tuneCenterFromProfile(kin, await loadSeedMin(ds));
  let state = {
    center: initialCenter,
    stepFraction: 0.5,
    epoch: 0,
  };
  let bestFitness = run.best_fitness ?? -Infinity;
  let bestCenter = state.center;
  const grid: Record<string, unknown>[] = [...(run.grid ?? [])];

  // Baseline: дефолтный центр — точка отсчёта, иначе примем первый probe вслепую.
  const baseFitness = evaluateTuneCenter(candidates, profile, state.center, until).fitness;
  if (baseFitness > bestFitness) {
    bestFitness = baseFitness;
    bestCenter = state.center;
  }

  while (state.epoch < maxEpochs) {
    if (await isCancelled(ds, runId)) return;

    let improved = false;
    for (const axis of defaultTuneAxes) {
      for (const dir of [-1, 1] as const) {
        const probe = clampCenter(probeCenter(state.center, axis, dir, state.stepFraction), initialCenter);
        const fitness = evaluateTuneCenter(candidates, profile, probe, until);
        grid.push({
          epoch: state.epoch,
          axis,
          dir,
          fitness: fitness.fitness,
          trackCount: fitness.trackCount,
        });
        if (fitness.fitness > bestFitness) {
          bestFitness = fitness.fitness;
          bestCenter = probe;
          state = { ...state, center: probe };
          improved = true;
        }
      }
    }
    state = patternSearchStep(state, improved);
    const bestConfig = bestConfigForProfile(profile, bestCenter);
    await persistProgress(ds, runId, {
      epochsDone: state.epoch,
      bestFitness,
      bestConfig,
      grid,
    });
  }

  if (await isCancelled(ds, runId)) return;

  await finishRun(ds, runId, {
    epochsDone: state.epoch,
    bestFitness,
    bestConfig: bestConfigForProfile(profile, bestCenter),
    grid,
  });
}

/** Старейший running job (FIFO). */
export async function pickRunningTuneRunId(ds: DataSource): Promise<string | null> {
  const [row] = await ds.query<Array<{ id: string }>>(
    `SELECT id FROM tracking_tune_runs
     WHERE status = 'running'
     ORDER BY created_at ASC
     LIMIT 1`,
  );
  return row?.id ?? null;
}
