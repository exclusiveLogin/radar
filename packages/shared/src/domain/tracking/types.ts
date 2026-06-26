/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: Базовые доменные типы tracking-домена (L1 треки, ноды, ковариация Kalman).
 * ---
 */

/** Профиль угрозы — тип летящей цели, определяет кинематику трека. */
export type ThreatProfile = "uav" | "rocket" | "balloon" | "unknown";

/** Режим участия ноды в треке (ADR-008). */
export type NodeMode = "correct" | "attach_only";

/** Статус трека после rebuild. */
export type TrackStatus = "active" | "closed" | "stale";

/** Состояние fork-convergence (Phase C): expanded Q после soft-assign. */
export type MutationState = {
  phase: "stable" | "expanded";
  consecutiveSoftAssigns: number;
};

/** Состояние фильтра Калмана: позиция + скорость + ковариационная матрица 4×4. */
export type KalmanStateJson = {
  /** Позиция X (метры в локальной проекции). */
  x: number;
  /** Позиция Y (метры в локальной проекции). */
  y: number;
  /** Скорость по X (м/с). */
  vx: number;
  /** Скорость по Y (м/с). */
  vy: number;
  /** Ковариационная матрица 4×4 неопределённости. */
  P: number[][];
};

/**
 * Ссылка на первоисточник — для нескольких каналов об одном событии.
 * После ST-DBSCAN dedup все источники кластера сливаются в winner.sourceRefs.
 */
export type SourceRef = {
  eventLocationId?: string;
  parsedEventId?: string;
  rawMessageId?: string;
  channelId?: string;
  /** Сырой текст — для инспекции. */
  text?: string;
};

/**
 * Кандидат на добавление в трек — нормализованный из event_locations + parsed_events.
 * Это input для ST-DBSCAN dedup и затем для Kalman pipeline.
 */
export type TrackingCandidate = {
  eventLocationId: string;
  parsedEventId: string;
  occurredAt: Date;
  lat: number;
  lon: number;
  /** Связанный place (для L2 rollup). */
  placeId: string | null;
  /** Точность геолокации — определяет sigma наблюдения R. */
  precision: string;
  /** Доверие к каналу [0..1]. */
  trust: number;
  eventType: string;
  eventCategory: string | null;
  /** null означает не найдено в status_dictionary. */
  affectsKinematics: boolean | null;
  /** Фронтовой регион — даёт boost при выборе seed. */
  isFrontRegion: boolean;
  /** Глубина РФ (не фронт) — штраф seed, bias attach. */
  isInteriorRf?: boolean;
  /**
   * Гео-дистанция (км) от центроида региона точки до ближайшего фронт-региона.
   * Precomputed в regions.front_distance_km. null → coeff падает на boolean-фолбэк.
   */
  frontDistanceKm?: number | null;
  /** Размер ST-DBSCAN кластера (для tie-break). */
  clusterSize?: number;
  threatProfile: ThreatProfile;
  mode: NodeMode;
  sourceRefs: SourceRef[];
};

/** Нода трека после Kalman-шага. */
export type TrajectoryNode = {
  id: string;
  trackId: string;
  seq: number;
  occurredAt: Date;
  lat: number;
  lon: number;
  placeId: string | null;
  mode: NodeMode;
  kalmanState: KalmanStateJson | null;
  sourceRefs: SourceRef[];
};

/** Трек — агрегат нод с кинематическими метаданными. */
export type TrajectoryTrack = {
  id: string;
  status: TrackStatus;
  threatProfile: ThreatProfile;
  firstAt: Date;
  lastAt: Date;
  lastLat: number;
  lastLon: number;
  velocityMs: number | null;
  bearingDeg: number | null;
  nodeCount: number;
  /** Накопленная дальность от origin (м) — для termination gate. */
  totalDistanceM: number;
  nodes?: TrajectoryNode[];
};
