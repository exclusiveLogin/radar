import type { BackfillStrategy } from "../../schemas/ingest/ingest-domain";

/** Результат preflight: границы истории канала в Telegram по message.id. */
export type BackfillPreflight = {
  minId: string;
  maxId: string;
  minPostedAt: string;
  maxPostedAt: string;
  probedAt: string;
};

/** Читает сохранённый preflight из params job. */
export function readBackfillPreflight(params: Record<string, unknown>): BackfillPreflight | null {
  const raw = params.preflight;
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (
    typeof p.minId !== "string" ||
    typeof p.maxId !== "string" ||
    typeof p.minPostedAt !== "string" ||
    typeof p.maxPostedAt !== "string" ||
    typeof p.probedAt !== "string"
  ) {
    return null;
  }
  return {
    minId: p.minId,
    maxId: p.maxId,
    minPostedAt: p.minPostedAt,
    maxPostedAt: p.maxPostedAt,
    probedAt: p.probedAt,
  };
}

function normalizeStrategy(strategy: string): BackfillStrategy {
  if (strategy === "all") return "full_history";
  return strategy as BackfillStrategy;
}

/**
 * Id-границы для оценки прогресса: preflight и/или явный диапазон в params.
 */
export function resolveBackfillIdBounds(
  strategy: string,
  params: Record<string, unknown>,
): { minId: string; maxId: string } | null {
  const normalized = normalizeStrategy(strategy);
  const preflight = readBackfillPreflight(params);
  const fromExternalId =
    typeof params.fromExternalId === "string" ? params.fromExternalId : undefined;
  const toExternalId =
    typeof params.toExternalId === "string" ? params.toExternalId : undefined;

  if (normalized === "by_external_id_range") {
    const minId = fromExternalId ?? preflight?.minId;
    const maxId = toExternalId ?? preflight?.maxId;
    if (minId && maxId) return { minId, maxId };
  }

  if (preflight) {
    return { minId: preflight.minId, maxId: preflight.maxId };
  }

  return null;
}

/** Направление стрима: false = от последнего сообщения к старым (default backfill). */
export function readBackfillStreamReverse(params: Record<string, unknown>): boolean {
  return params.streamReverse === true;
}

/**
 * Примерный % докачки по checkpoint.offsetId и id-диапазону (не точный count сообщений).
 * При streamReverse=false (новые→старые): 0% у maxId, 100% у minId.
 */
export function computeBackfillPercentApprox(
  strategy: string,
  params: Record<string, unknown>,
  checkpointOffsetId: string | null,
): number | null {
  if (!checkpointOffsetId) return null;

  const bounds = resolveBackfillIdBounds(strategy, params);
  if (!bounds) return null;

  const min = Number(bounds.minId);
  const max = Number(bounds.maxId);
  const current = Number(checkpointOffsetId);
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(current)) {
    return null;
  }

  const span = max - min;
  if (span <= 0) return null;

  const reverse = readBackfillStreamReverse(params);
  const ratio = reverse ? (current - min) / span : (max - current) / span;
  return Math.min(100, Math.max(0, Math.round(ratio * 100)));
}

/** Checkpoint дальше по направлению стрима (для merge WS/REST). */
export function pickFurtherCheckpointOffsetId(
  params: Record<string, unknown>,
  prev: string | null | undefined,
  next: string | null | undefined,
): string | null {
  const a = prev ?? null;
  const b = next ?? null;
  if (!a) return b;
  if (!b) return a;
  const reverse = readBackfillStreamReverse(params);
  const pn = Number(a);
  const nn = Number(b);
  if (!Number.isFinite(pn) || !Number.isFinite(nn)) return b;
  return reverse ? (nn > pn ? b : a) : (nn < pn ? b : a);
}

/** % не откатывается при round-robin (берём максимум известного). */
export function mergeBackfillPercentMonotonic(
  prev: number | null | undefined,
  next: number | null | undefined,
): number | null {
  if (prev == null) return next ?? null;
  if (next == null) return prev;
  return Math.max(prev, next);
}

export type BackfillProgressInput = {
  strategy: string;
  params: Record<string, unknown>;
  stats: { inserted: number; duplicates: number; parsed: number };
  checkpointOffsetId: string | null;
  checkpointPostedAt: string | null;
};

/** Ключ в job.params: метка round-robin slice (пишет backfill-демон). */
export const BACKFILL_ROUND_ROBIN_SLICE_KEY = "roundRobinSlice" as const;

export type BackfillRoundRobinSlice = "active" | "waiting";

/** Читает метку round-robin из params job. */
export function readBackfillRoundRobinSlice(
  params: Record<string, unknown>,
): BackfillRoundRobinSlice | null {
  const raw = params[BACKFILL_ROUND_ROBIN_SLICE_KEY];
  if (raw === "active" || raw === "waiting") return raw;
  return null;
}

/** Устанавливает или снимает метку round-robin в params. */
export function withBackfillRoundRobinSlice(
  params: Record<string, unknown>,
  slice: BackfillRoundRobinSlice | null,
): Record<string, unknown> {
  const next = { ...params };
  if (slice == null) {
    delete next[BACKFILL_ROUND_ROBIN_SLICE_KEY];
  } else {
    next[BACKFILL_ROUND_ROBIN_SLICE_KEY] = slice;
  }
  return next;
}

/** DTO для админки: slice только у pending/running job. */
export function resolveBackfillRoundRobinSlice(
  status: string,
  params: Record<string, unknown>,
): BackfillRoundRobinSlice | null {
  if (status !== "pending" && status !== "running") return null;
  return readBackfillRoundRobinSlice(params);
}

/** Сборка progress DTO для API/WS из job + checkpoint. */
export function buildBackfillJobProgress(input: BackfillProgressInput) {
  const bounds = resolveBackfillIdBounds(input.strategy, input.params);
  return {
    inserted: input.stats.inserted,
    duplicates: input.stats.duplicates,
    parsed: input.stats.parsed,
    checkpointOffsetId: input.checkpointOffsetId,
    checkpointPostedAt: input.checkpointPostedAt,
    boundsMinId: bounds?.minId ?? null,
    boundsMaxId: bounds?.maxId ?? null,
    percentApprox: computeBackfillPercentApprox(
      input.strategy,
      input.params,
      input.checkpointOffsetId,
    ),
  };
}
