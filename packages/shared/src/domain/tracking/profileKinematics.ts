/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: Кинематические профили летящих целей — физические ограничения для Kalman,
 *          ST-DBSCAN dedup и termination gate.
 * ---
 */
import type { ThreatProfile } from "./types";

/**
 * Параметры кинематической модели для каждого типа цели.
 *
 * Используются в:
 * - linkNodes() — maxGapMs, maxLinkDistanceM
 * - innovationGate() — maxVelocityMs, chi2Threshold, rearThresholdM
 * - kalmanStep() — processNoiseScale
 * - observationCovarianceMeters() × observationSigmaScale → R
 * - buildTrackMetadata() — staleAfterMs
 * - trackTerminationPolicy() — maxRangeFromOriginM, maxTrackDurationMs
 * - stdbscanDedup() — stdbscanEpsilonSpatialM, stdbscanEpsilonTemporalMs
 */
export type ProfileKinematics = {
  /** Максимальная скорость (м/с) — gate на innovation. */
  maxVelocityMs: number;
  /** Максимальная дистанция линковки к предыдущей ноде (м). */
  maxLinkDistanceM: number;
  /**
   * Максимальный временной разрыв между соседними наблюдениями (мс).
   * Если gap больше — новый кандидат не линкуется к треку → стартует новый.
   */
  maxGapMs: number;
  /**
   * Время тишины после последнего наблюдения (мс) → статус closed/stale.
   * Отличие от maxTrackDurationMs: срабатывает только при отсутствии репортов.
   */
  staleAfterMs: number;
  /**
   * Максимальный полный lifetime трека от firstAt до lastAt (мс).
   * Закрывает трек даже при регулярных репортах — физический лимит модели.
   */
  maxTrackDurationMs: number;
  /**
   * Максимальная накопленная дальность от origin (м).
   * Закрывает трек при превышении радиуса действия профиля.
   */
  maxRangeFromOriginM: number;
  /** Масштабный коэффициент матрицы Q процессного шума Kalman. */
  processNoiseScale: number;
  /**
   * Множитель σ матрицы наблюдений R (OSINT/телега — шире эллипс доверия).
   * effective σ = base(precision, trust) × observationSigmaScale.
   */
  observationSigmaScale: number;
  /** Chi² порог innovation gate (больше → шире кольцо Mahalanobis). */
  chi2Threshold: number;
  /** Допуск смещения «позади» вдоль вектора скорости, м (rear-front gate). */
  rearThresholdM: number;
  /** Пространственный радиус кластера для ST-DBSCAN dedup (м). */
  stdbscanEpsilonSpatialM: number;
  /** Временное окно кластера для ST-DBSCAN dedup (мс). */
  stdbscanEpsilonTemporalMs: number;
  /** Минимальное количество точек для образования кластера (dedup). */
  stdbscanMinPts: number;
};

/** SSOT кинематических профилей по типу цели. */
export const PROFILE_KINEMATICS: Record<ThreatProfile, ProfileKinematics> = {
  /**
   * БПЛА: ориентир FP-1 / Ан-196 «Лютый».
   * Крейс ~150 км/ч, макс ~250 км/ч, дальность до 1600 км, полёт до 10 ч.
   */
  uav: {
    maxVelocityMs: 70, // 250 км/ч
    // Реальный шаг между разрежёнными OSINT-репортами p50≈142км (см. tracking:kinematics).
    // 100км отрезал >50% настоящих переходов → 250км ≈ maxVelocity×1ч.
    maxLinkDistanceM: 250_000,
    maxGapMs: 3 * 60 * 60 * 1000, // 3 ч — реальный p90 gap ≈ 5ч, дефолт 1ч рвал цепи
    staleAfterMs: 4 * 60 * 60 * 1000, // 4 ч тишины на длинном маршруте
    maxTrackDurationMs: 10 * 60 * 60 * 1000, // 10 ч (Лютый)
    maxRangeFromOriginM: 1_600_000, // FP-1
    processNoiseScale: 0.8,
    observationSigmaScale: 2.5,
    chi2Threshold: 18,
    rearThresholdM: 4_000,
    stdbscanEpsilonSpatialM: 20_000,
    stdbscanEpsilonTemporalMs: 20 * 60 * 1000, // 20 мин
    stdbscanMinPts: 2,
  },
  /**
   * Ракета (крылатая): ориентир FP-5 Flamingo / Storm Shadow SCALP.
   * Крейс ~850–900 км/ч (Mach ~0.8), дальность 550–3000 км, полёт до 4 ч.
   */
  rocket: {
    maxVelocityMs: 290, // Mach ~0.85
    maxLinkDistanceM: 250_000, // сегмент маршрута между редкими OSINT-репортами
    maxGapMs: 15 * 60 * 1000, // 15 мин
    staleAfterMs: 90 * 60 * 1000, // 1.5 ч без репортов
    maxTrackDurationMs: 4 * 60 * 60 * 1000, // FP-5 до 4 ч
    maxRangeFromOriginM: 3_000_000, // FP-5; Storm Shadow ~550 км — нижняя граница класса
    processNoiseScale: 2.5,
    observationSigmaScale: 2.0,
    chi2Threshold: 15,
    rearThresholdM: 6_000,
    stdbscanEpsilonSpatialM: 50_000,
    stdbscanEpsilonTemporalMs: 5 * 60 * 1000, // 5 мин
    stdbscanMinPts: 2,
  },
  balloon: {
    maxVelocityMs: 15,
    maxLinkDistanceM: 5_000,
    maxGapMs: 60 * 60 * 1000,           // 60 мин
    staleAfterMs: 4 * 60 * 60 * 1000,  // 4 ч
    maxTrackDurationMs: 12 * 60 * 60 * 1000, // 12 ч
    maxRangeFromOriginM: 200_000,       // 200 км
    processNoiseScale: 0.5,
    observationSigmaScale: 3.0,
    chi2Threshold: 22,
    rearThresholdM: 3_000,
    stdbscanEpsilonSpatialM: 5_000,
    stdbscanEpsilonTemporalMs: 30 * 60 * 1000,  // 30 мин
    stdbscanMinPts: 2,
  },
  unknown: {
    maxVelocityMs: 70,
    maxLinkDistanceM: 250_000,
    maxGapMs: 3 * 60 * 60 * 1000,
    staleAfterMs: 4 * 60 * 60 * 1000,
    maxTrackDurationMs: 10 * 60 * 60 * 1000,
    maxRangeFromOriginM: 1_600_000,
    processNoiseScale: 0.8,
    observationSigmaScale: 2.5,
    chi2Threshold: 18,
    rearThresholdM: 4_000,
    stdbscanEpsilonSpatialM: 20_000,
    stdbscanEpsilonTemporalMs: 20 * 60 * 1000,
    stdbscanMinPts: 2,
  },
};

type ProfileKinematicsOverrides = Partial<Record<ThreatProfile, Partial<ProfileKinematics>>>;

/**
 * Defaults из PROFILE_KINEMATICS + overrides из tracking_pipeline_state.config.
 */
export function resolveProfileKinematics(
  profile: ThreatProfile,
  overrides?: ProfileKinematicsOverrides,
): ProfileKinematics {
  const base = PROFILE_KINEMATICS[profile];
  const patch = overrides?.[profile];
  return patch ? { ...base, ...patch } : base;
}

/** Максимальный ε_temporal среди всех профилей — для overlap окна батча. */
export function maxEpsilonTemporalMs(overrides?: ProfileKinematicsOverrides): number {
  const profiles: ThreatProfile[] = ["uav", "rocket", "balloon", "unknown"];
  return Math.max(...profiles.map(p => resolveProfileKinematics(p, overrides).stdbscanEpsilonTemporalMs));
}
