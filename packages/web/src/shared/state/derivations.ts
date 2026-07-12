import type {
  IngestProviderConnectionSnapshot,
  MapPlaceSnapshot,
  MapRegionSnapshot,
  StateLevel,
  Warning,
} from "@radar/shared";
import { LEVEL_COLORS, LEVEL_LABELS } from "../config/mapConfig.service";
import type { DonutSegment } from "../ds/Donut";

const ALL_LEVELS: StateLevel[] = ["red", "orange", "yellow", "green", "grey"];

/** Числовой вес уровня: чем выше — тем опаснее. */
const LEVEL_SEVERITY: Record<StateLevel, number> = {
  grey: 0,
  green: 1,
  yellow: 2,
  orange: 3,
  red: 4,
};

/**
 * Эффективный уровень места с учётом регионального контекста.
 *
 * Подавление дочерних places при региональном clear и TTL — бэкенд + mapStore.
 * Региональный raise детальные точки не гасит. Фронтенд эскалирует цвет вверх.
 */
export function effectivePlaceLevel(
  placeLevel: StateLevel,
  regionLevel: StateLevel,
): StateLevel {
  return LEVEL_SEVERITY[regionLevel] > LEVEL_SEVERITY[placeLevel]
    ? regionLevel
    : placeLevel;
}

/** Старые green/grey не рисуем на карте (гео и схема). */
const REGION_CALM_STALE_MS = 3 * 60 * 60 * 1000;

/**
 * Регион показываем на карте: alarm-уровни всегда; green/grey — только первые 3ч
 * относительно якоря просмотра (live: now, replay: asOf).
 */
export function isRegionVisibleOnMap(
  region: MapRegionSnapshot,
  viewNowMs: number = Date.now(),
): boolean {
  if (region.stateLevel !== "green" && region.stateLevel !== "grey") {
    return true;
  }
  if (!region.statusEventAt) return false;
  return viewNowMs - new Date(region.statusEventAt).getTime() < REGION_CALM_STALE_MS;
}

/** SSOT: коды регионов, видимых на карте при якоре viewNowMs. */
export function visibleRegionCodes(
  regions: Map<string, MapRegionSnapshot>,
  viewNowMs: number,
): string[] {
  const codes: string[] = [];
  for (const region of regions.values()) {
    if (isRegionVisibleOnMap(region, viewNowMs)) codes.push(region.regionCode);
  }
  return codes.sort();
}

/** Fingerprint видимых регионов для geo-fetch/paint. */
export function visibleRegionCodesFingerprint(
  regions: Map<string, MapRegionSnapshot>,
  viewNowMs: number,
): string {
  return visibleRegionCodes(regions, viewNowMs).join("\0");
}

/** geoFeatureId активных places для districts-fetch. */
export function activeDistrictGeoFeatureIds(
  places: Map<string, MapPlaceSnapshot>,
): string[] {
  const ids: string[] = [];
  for (const place of places.values()) {
    if (place.geoFeatureId) ids.push(place.geoFeatureId);
  }
  return ids.sort();
}

/** Fingerprint districts-fetch. */
export function activeDistrictIdsFingerprint(
  places: Map<string, MapPlaceSnapshot>,
): string {
  return activeDistrictGeoFeatureIds(places).join("\0");
}

/** Счётчики регионов по уровню состояния. */
export function countRegionsByLevel(
  regions: Map<string, MapRegionSnapshot>,
): Record<StateLevel, number> {
  const counts: Record<StateLevel, number> = {
    red: 0,
    orange: 0,
    yellow: 0,
    green: 0,
    grey: 0,
  };
  for (const region of regions.values()) {
    counts[region.stateLevel]++;
  }
  return counts;
}

/** Сегменты для donut-диаграммы распределения уровней. */
export function levelDonutSegments(
  counts: Record<StateLevel, number>,
): DonutSegment[] {
  return ALL_LEVELS.map((level) => ({
    label: LEVEL_LABELS[level],
    value: counts[level],
    color: LEVEL_COLORS[level],
  }));
}

/** Топ-N регионов по activity (убывание). */
export function topRegionsByActivity(
  regions: Map<string, MapRegionSnapshot>,
  limit = 10,
): MapRegionSnapshot[] {
  return [...regions.values()]
    .filter((r) => r.activity > 0)
    .sort((a, b) => b.activity - a.activity)
    .slice(0, limit);
}

/**
 * Производит карту регионов с учётом соседней подсветки (read-side derivation).
 *
 * Правило: если у региона stateLevel === 'grey' И хотя бы один сосед имеет
 * собственный уровень 'red' — регион получает производный уровень 'yellow'.
 * Любой собственный сигнал (включая green = явный отбой) приоритетнее.
 * statusEventAt производного yellow = statusEventAt красного соседа, чтобы
 * яркость затухания синхронизировалась с источником угрозы.
 * Возвращает новую Map только если есть хотя бы один производный yellow.
 */
export function deriveNeighborLevels(
  regions: Map<string, MapRegionSnapshot>,
  adjacency: Record<string, string[]>,
): Map<string, MapRegionSnapshot> {
  // Собираем red-регионы с их statusEventAt для передачи соседям
  const redRegions = new Map<string, string | undefined>();
  for (const region of regions.values()) {
    if (region.stateLevel === "red") redRegions.set(region.regionCode, region.statusEventAt);
  }
  if (redRegions.size === 0) return regions;

  let changed = false;
  const next = new Map(regions);
  for (const [code, region] of regions) {
    if (region.stateLevel !== "grey") continue;
    const neighbors = adjacency[code] ?? [];
    const redNeighbor = neighbors.find((n) => redRegions.has(n));
    if (!redNeighbor) continue;
    // Берём statusEventAt красного соседа — fade синхронизирован с источником
    next.set(code, {
      ...region,
      stateLevel: "yellow",
      statusEventAt: redRegions.get(redNeighbor) ?? region.statusEventAt,
    });
    changed = true;
  }
  return changed ? next : regions;
}

/** Число активных регионов (stateLevel ≠ grey). */
export function countActiveRegions(
  regions: Map<string, MapRegionSnapshot>,
): number {
  return [...regions.values()].filter((r) => r.stateLevel !== "grey").length;
}

/** Число активных мест (stateLevel ≠ grey). */
export function countActivePlaces(
  places: Map<string, { stateLevel: StateLevel }>,
): number {
  return [...places.values()].filter((p) => p.stateLevel !== "grey").length;
}

/** Место видно на карте только если регион известен и не grey. */
export function isPlaceVisibleOnMap(
  place: MapPlaceSnapshot,
  regions: Map<string, MapRegionSnapshot>,
  viewNowMs: number = Date.now(),
): boolean {
  const region = regions.get(place.regionCode);
  if (!region || !isRegionVisibleOnMap(region, viewNowMs)) return false;
  return place.stateLevel !== "grey";
}

/** Счётчики мест на карте (с учётом grey-регионов), по уровню place. */
export function countPlacesOnMapByLevel(
  places: Map<string, MapPlaceSnapshot>,
  regions: Map<string, MapRegionSnapshot>,
): Record<StateLevel, number> {
  const counts: Record<StateLevel, number> = {
    red: 0,
    orange: 0,
    yellow: 0,
    green: 0,
    grey: 0,
  };
  for (const place of places.values()) {
    if (!isPlaceVisibleOnMap(place, regions, Date.now())) continue;
    counts[place.stateLevel]++;
  }
  return counts;
}

export function countVisiblePlacesOnMap(
  places: Map<string, MapPlaceSnapshot>,
  regions: Map<string, MapRegionSnapshot>,
): number {
  let n = 0;
  for (const place of places.values()) {
    if (isPlaceVisibleOnMap(place, regions, Date.now())) n += 1;
  }
  return n;
}

/**
 * Бакеты событий по времени для sparkline.
 * Делит окно warnings на bucketCount интервалов.
 */
export function warningsTimeBuckets(
  warnings: Warning[],
  bucketCount = 24,
): number[] {
  if (warnings.length === 0) return Array(bucketCount).fill(0);

  const times = warnings.map((w) => new Date(w.eventAt).getTime());
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const range = maxT - minT || 1;
  const bucketMs = range / bucketCount;

  const buckets = Array(bucketCount).fill(0);
  for (const t of times) {
    const idx = Math.min(
      bucketCount - 1,
      Math.floor((t - minT) / bucketMs),
    );
    buckets[idx]++;
  }
  return buckets;
}

const MSK = "Europe/Moscow";

/** Время сообщения: только часы если <24ч, иначе дата + время (MSK). */
export function formatMessagePostedAt(iso: string, nowMs = Date.now()): string {
  const ageMs = nowMs - new Date(iso).getTime();
  const timeOpts: Intl.DateTimeFormatOptions = {
    timeZone: MSK,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  if (ageMs >= 0 && ageMs < 24 * 60 * 60 * 1000) {
    return new Date(iso).toLocaleTimeString("ru-RU", timeOpts);
  }
  return new Date(iso).toLocaleString("ru-RU", {
    timeZone: MSK,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Порог устаревания heartbeat (worker шлёт каждые 30с). */
export const INGEST_HEARTBEAT_STALE_MS = 90_000;

export type IngestProviderDisplayStatus = {
  kind: "ok" | "warn" | "error" | "neutral";
  label: string;
  pulse: boolean;
  tip: string;
};

/** Live MTProto-фаза → бейдж для админки/карты. */
export function resolveIngestConnectionDisplay(
  connection: IngestProviderConnectionSnapshot | null | undefined,
): IngestProviderDisplayStatus | null {
  if (!connection || connection.phase === "idle") return null;

  const detail = connection.detail?.trim() || null;

  switch (connection.phase) {
    case "connecting":
      return {
        kind: "warn",
        label: "Подключение…",
        pulse: true,
        tip: detail ?? "Установка MTProto-соединения с Telegram",
      };
    case "reconnecting":
      return {
        kind: "warn",
        label: "Переподключение…",
        pulse: true,
        tip: detail ?? "Повторное подключение к Telegram",
      };
    case "connected":
      return {
        kind: "warn",
        label: "Подключён",
        pulse: true,
        tip: detail ?? "Сессия готова, старт live duty…",
      };
    case "live":
      return {
        kind: "ok",
        label: "Live",
        pulse: true,
        tip: detail ?? "Слушает каналы",
      };
    case "disconnected":
      return {
        kind: "error",
        label: "Отключён",
        pulse: false,
        tip: detail ?? "Нет соединения с Telegram (VPN/сеть?)",
      };
    case "error":
      return {
        kind: "error",
        label: "Ошибка",
        pulse: false,
        tip: detail ?? "Ошибка соединения ingest",
      };
    default:
      return null;
  }
}

/** Бейдж канала: live connection worker > listening из БД. */
export function resolveChannelIngestDisplay(input: {
  listening: boolean;
  providerStatus: string | null | undefined;
  connection: IngestProviderConnectionSnapshot | null | undefined;
}): IngestProviderDisplayStatus {
  const live = resolveIngestConnectionDisplay(input.connection);
  if (live) return live;

  if (input.listening) {
    return {
      kind: "ok",
      label: "слушается",
      pulse: true,
      tip: "Provider active + binding enabled",
    };
  }
  if (input.providerStatus === "error") {
    return {
      kind: "error",
      label: "ошибка",
      pulse: false,
      tip: "Provider error — см. lastError в статусе канала",
    };
  }
  if (input.providerStatus === "draft") {
    return {
      kind: "neutral",
      label: "черновик",
      pulse: false,
      tip: "Запустите провайдер: POST /providers/:id/start",
    };
  }
  if (input.providerStatus === "paused") {
    return {
      kind: "warn",
      label: "пауза",
      pulse: false,
      tip: "Провайдер остановлен",
    };
  }
  return {
    kind: "neutral",
    label: "пауза",
    pulse: false,
    tip: "Канал не слушается",
  };
}

/**
 * Live-статус канала для UI: DB status + worker probe + свежесть heartbeat.
 * `active` в PostgreSQL ≠ worker сейчас слушает Telegram.
 */
export function resolveIngestProviderDisplayStatus(
  provider: {
    id: string;
    status: "draft" | "active" | "paused" | "error";
    lastHeartbeatAt: string | null;
    lastError: string | null;
    title: string;
    key: string;
  },
  ctx: {
    apiOk: boolean;
    dbReady: boolean;
    workerReachable: boolean;
    orchestratorRunning: boolean;
    connection?: IngestProviderConnectionSnapshot | null;
  },
): IngestProviderDisplayStatus {
  const hbAge = provider.lastHeartbeatAt
    ? Date.now() - new Date(provider.lastHeartbeatAt).getTime()
    : Number.POSITIVE_INFINITY;
  const hbLabel = formatAge(provider.lastHeartbeatAt);
  const heartbeatStale = hbAge > INGEST_HEARTBEAT_STALE_MS;

  if (!ctx.apiOk) {
    return {
      kind: "error",
      label: "API недоступен",
      pulse: false,
      tip: "Статус канала из БД может быть устаревшим — API не отвечает.",
    };
  }
  if (!ctx.dbReady) {
    return {
      kind: "error",
      label: "БД не готова",
      pulse: false,
      tip: "Без PostgreSQL ingest не работает.",
    };
  }
  if (!ctx.workerReachable) {
    return {
      kind: "error",
      label: "Worker offline",
      pulse: false,
      tip: `В БД: ${provider.status}. Probe worker недоступен — канал не слушается.`,
    };
  }

  const liveConnection = resolveIngestConnectionDisplay(ctx.connection);
  if (
    liveConnection &&
    ctx.connection &&
    ["connecting", "reconnecting", "connected", "disconnected", "error", "live"].includes(
      ctx.connection.phase,
    )
  ) {
    if (ctx.connection.phase !== "live" || provider.status === "active") {
      return liveConnection;
    }
  }

  if (!ctx.orchestratorRunning) {
    return {
      kind: "warn",
      label: "Orchestrator off",
      pulse: false,
      tip: `Worker запущен, но IngestOrchestrator не работает. DB status: ${provider.status}.`,
    };
  }

  if (provider.status === "error") {
    return {
      kind: "error",
      label: "Ошибка",
      pulse: false,
      tip: provider.lastError ?? "Ошибка провайдера в БД",
    };
  }
  if (provider.status === "paused") {
    return {
      kind: "warn",
      label: "Пауза",
      pulse: false,
      tip: "Провайдер остановлен через admin API.",
    };
  }
  if (provider.status === "draft") {
    return {
      kind: "neutral",
      label: "Черновик",
      pulse: false,
      tip: "Запустите: POST /providers/:id/start",
    };
  }

  if (heartbeatStale) {
    return {
      kind: "warn",
      label: "Нет heartbeat",
      pulse: false,
      tip: `Последний heartbeat: ${hbLabel}. Worker не обновляет статус >90с.`,
    };
  }

  return {
    kind: "ok",
    label: "Live",
    pulse: true,
    tip: `${provider.title} (${provider.key}) · heartbeat ${hbLabel}`,
  };
}

/** Форматирует возраст ISO-даты в человекочитаемый вид. */
export function formatAge(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return "только что";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}с назад`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}м назад`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}ч назад`;
  return `${Math.floor(hr / 24)}д назад`;
}
