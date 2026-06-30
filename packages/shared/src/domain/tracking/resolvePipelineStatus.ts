/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: Человекочитаемый статус пайплайна треков для админки.
 * ---
 */

import type { TrackingRebuildStats } from "../../schemas/admin/tracking";

export type TrackingPipelineStatusCode =
  | "disabled"
  | "running"
  | "paused"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export type TrackingPipelineStatusView = {
  code: TrackingPipelineStatusCode;
  label: string;
  detail: string;
  remainingCandidates?: number;
};

type RunLike = {
  status: string;
  error?: string | null;
  stats?: Partial<Pick<TrackingRebuildStats, "stage" | "pendingCandidates">>;
  mode?: string;
} | null;

export type ResolvePipelineStatusInput = {
  enabled: boolean;
  paused: boolean;
  activeRun: RunLike;
  lastRun: RunLike;
  remainingCandidates?: number;
};

/**
 * SSOT: код + подпись + пояснение, почему пайплайн сейчас в таком состоянии.
 */
export function resolveTrackingPipelineStatus(
  input: ResolvePipelineStatusInput,
): TrackingPipelineStatusView {
  const { enabled, paused, activeRun, lastRun, remainingCandidates } = input;

  if (!enabled) {
    return {
      code: "disabled",
      label: "Выключен",
      detail: "Пайплайн остановлен. Нажмите «Включить» для запуска.",
    };
  }

  if (paused || activeRun?.status === "paused") {
    return {
      code: "paused",
      label: "Пауза",
      detail: "Обработка приостановлена оператором. Нажмите Resume.",
    };
  }

  if (activeRun?.status === "running") {
    const stage = activeRun.stats?.stage;
    const pending = activeRun.stats?.pendingCandidates;
    // done в stats при status=running — legacy/между тиками, не финал run
    if (stage === "idle" || stage === "done") {
      return {
        code: "running",
        label: "Обработка",
        detail:
          pending != null
            ? `Между тиками, в очереди ~${pending.toLocaleString("ru-RU")} точек.`
            : "Между тиками, следующий батч ~10 с.",
      };
    }
    return {
      code: "running",
      label: "Обработка",
      detail: stage ? `Стадия: ${stage}` : "Идёт обработка батча кандидатов.",
    };
  }

  if (lastRun?.status === "failed") {
    return {
      code: "failed",
      label: "Ошибка",
      detail: lastRun.error?.trim() || "Последний run завершился с ошибкой.",
    };
  }

  if (lastRun?.status === "cancelled") {
    return {
      code: "cancelled",
      label: "Отменён",
      detail: "Последний run отменён оператором.",
    };
  }

  const remaining = remainingCandidates ?? 0;
  if (remaining > 0) {
    return {
      code: "waiting",
      label: "Ожидание",
      detail: `В очереди ~${remaining.toLocaleString("ru-RU")} необработанных точек. Worker подхватит в следующем тике (~10 с).`,
      remainingCandidates: remaining,
    };
  }

  return {
    code: "completed",
    label: "Простой",
    detail:
      "Все pipeline-точки обработаны. % покрытия нодами может быть ниже 100% — dedup, skip, attach_only.",
    remainingCandidates: 0,
  };
}
