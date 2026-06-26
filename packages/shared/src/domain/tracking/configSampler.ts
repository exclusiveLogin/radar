/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: Pattern search sampler для авто-тюнинга tracking config.
 * ---
 */
import type { ProfileKinematics } from "./profileKinematics";
import type { ThreatProfile } from "./types";

export type TuneAxis =
  | "chi2"
  | "processNoise"
  | "seed"
  | "temporal"
  | "direction";

export type TuneCenter = {
  chi2Threshold: number;
  processNoiseScale: number;
  seedMin: number;
  maxGapMs: number;
  rearThresholdM: number;
};

export type PatternSearchState = {
  center: TuneCenter;
  stepFraction: number;
  epoch: number;
};

export const defaultTuneAxes: TuneAxis[] = [
  "chi2",
  "processNoise",
  "seed",
  "temporal",
  "direction",
];

/** Нижняя граница seedMin — защита от деления/вырождения. */
const SEED_MIN_FLOOR = 0.05;

/**
 * Шаг по оси: множитель (1 + stepFraction·direction).
 * stepFraction берётся из pattern-search и уменьшается при отсутствии улучшения —
 * это и даёт сходимость к локальному максимуму (refinement), а не фиксированные прыжки.
 */
export function probeCenter(
  center: TuneCenter,
  axis: TuneAxis,
  direction: -1 | 1,
  stepFraction = 0.5,
): TuneCenter {
  const factor = 1 + stepFraction * direction;
  switch (axis) {
    case "chi2":
      return { ...center, chi2Threshold: center.chi2Threshold * factor };
    case "processNoise":
      return { ...center, processNoiseScale: center.processNoiseScale * factor };
    case "seed":
      return { ...center, seedMin: Math.max(SEED_MIN_FLOOR, center.seedMin * factor) };
    case "temporal":
      return { ...center, maxGapMs: center.maxGapMs * factor };
    case "direction":
      return { ...center, rearThresholdM: center.rearThresholdM * factor };
  }
}

/** Pattern move: комбинированный шаг по улучшившим осям. */
export function patternMove(
  center: TuneCenter,
  improvedAxes: Array<{ axis: TuneAxis; direction: -1 | 1 }>,
): TuneCenter {
  let next = { ...center };
  for (const { axis, direction } of improvedAxes) {
    next = probeCenter(next, axis, direction);
  }
  return next;
}

/** Одна эпоха pattern search: shrink step если нет улучшения. */
export function patternSearchStep(
  state: PatternSearchState,
  improved: boolean,
  minStepFraction = 0.05,
): PatternSearchState {
  if (improved) {
    return { ...state, epoch: state.epoch + 1 };
  }
  const nextStep = state.stepFraction / 2;
  return {
    center: state.center,
    stepFraction: Math.max(minStepFraction, nextStep),
    epoch: state.epoch + 1,
  };
}

/** Мержит TuneCenter в ProfileKinematics patch. */
export function tuneCenterToProfilePatch(
  center: TuneCenter,
): Partial<ProfileKinematics> {
  return {
    chi2Threshold: center.chi2Threshold,
    processNoiseScale: center.processNoiseScale,
    maxGapMs: center.maxGapMs,
    rearThresholdM: center.rearThresholdM,
  };
}

/** Дефолтный центр из профиля. */
export function tuneCenterFromProfile(kin: ProfileKinematics, seedMin = 0.45): TuneCenter {
  return {
    chi2Threshold: kin.chi2Threshold,
    processNoiseScale: kin.processNoiseScale,
    seedMin,
    maxGapMs: kin.maxGapMs,
    rearThresholdM: kin.rearThresholdM,
  };
}

export type ProfileTuneOverrides = Partial<Record<ThreatProfile, Partial<ProfileKinematics>>>;
