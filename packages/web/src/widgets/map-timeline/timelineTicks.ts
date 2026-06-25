import type { TimelineScale } from "../../shared/state/timelineStore";

export type TimelineTick = {
  /** 0…1 позиция на треке. */
  ratio: number;
  /** Подпись под тиком (опционально). */
  label?: string;
  /** Major tick — выше и с подписью. */
  major?: boolean;
};

const MSK = "Europe/Moscow";

function formatTickTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: MSK,
  });
}

function formatTickDay(ms: number): string {
  return new Date(ms).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    timeZone: MSK,
  });
}

/**
 * Генерация тиков для трека таймлайна по масштабу и окну.
 */
export function buildTimelineTicks(
  scale: TimelineScale,
  windowStartMs: number,
  windowEndMs: number,
): TimelineTick[] {
  const span = windowEndMs - windowStartMs;
  if (span <= 0) return [];

  if (scale === "24h") {
    const stepMs = 4 * 60 * 60 * 1000;
    const ticks: TimelineTick[] = [];
    const first = Math.ceil(windowStartMs / stepMs) * stepMs;
    for (let t = first; t <= windowEndMs; t += stepMs) {
      const ratio = (t - windowStartMs) / span;
      if (ratio < 0 || ratio > 1) continue;
      ticks.push({
        ratio,
        label: formatTickTime(t),
        major: true,
      });
    }
    return ticks;
  }

  if (scale === "7d") {
    const dayMs = 24 * 60 * 60 * 1000;
    const ticks: TimelineTick[] = [];
    const mskOffsetGuess = 3 * 60 * 60 * 1000;
    const firstDay =
      Math.ceil((windowStartMs + mskOffsetGuess) / dayMs) * dayMs - mskOffsetGuess;
    for (let t = firstDay; t <= windowEndMs; t += dayMs) {
      const ratio = (t - windowStartMs) / span;
      if (ratio < 0 || ratio > 1) continue;
      ticks.push({
        ratio,
        label: formatTickDay(t),
        major: true,
      });
    }
    return ticks;
  }

  const stepMs = 5 * 24 * 60 * 60 * 1000;
  const ticks: TimelineTick[] = [];
  const first = Math.ceil(windowStartMs / stepMs) * stepMs;
  for (let t = first; t <= windowEndMs; t += stepMs) {
    const ratio = (t - windowStartMs) / span;
    if (ratio < 0 || ratio > 1) continue;
    ticks.push({
      ratio,
      label: formatTickDay(t),
      major: true,
    });
  }
  return ticks;
}
