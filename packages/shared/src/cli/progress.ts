/**
 * Единый live progress-UI для длительных CLI (geo sync, backfill, reparse).
 * В не-TTY (CI, pipe) — текстовые вехи каждые ~10%.
 */
import { Presets, SingleBar } from "cli-progress";

/** Доп. счётчики в строке бара (например ok/failed). */
export type ProgressCounters = Record<string, number>;

/** Управление активным прогресс-баром. */
export type ProgressHandle = {
  tick(delta?: number, counters?: ProgressCounters): void;
  update(counters: ProgressCounters): void;
  /** Уточнить total на лету (aliases после places). */
  setTotal(total: number): void;
  stop(): void;
};

export type CreateProgressOptions = {
  /** Вызывается при старте/остановке бара (worker: подавление шумных логов). */
  onActiveChange?: (active: boolean) => void;
};

const isTty = Boolean(process.stdout.isTTY);

function formatCounters(counters: ProgressCounters | undefined): string {
  if (!counters) return "";
  const parts = Object.entries(counters).map(([key, value]) => `${key}=${value}`);
  return parts.length > 0 ? ` | ${parts.join(" ")}` : "";
}

/** Создаёт прогресс-бар для процесса из `total` шагов. */
export function createProgress(
  label: string,
  total: number,
  options?: CreateProgressOptions,
): ProgressHandle {
  let value = 0;
  let counters: ProgressCounters = {};

  if (!isTty) {
    let lastPercent = -1;
    const log = () => {
      const percent = total > 0 ? Math.floor((value / total) * 100) : 100;
      if (percent >= lastPercent + 10 || value >= total) {
        lastPercent = percent;
        console.log(`${label}: ${value}/${total} (${percent}%)${formatCounters(counters)}`);
      }
    };
    return {
      tick(delta = 1, next) {
        value += delta;
        if (next) counters = { ...counters, ...next };
        log();
      },
      update(next) {
        counters = { ...counters, ...next };
      },
      stop() {
        value = total > 0 ? total : value;
        log();
      },
      setTotal() {
        // non-TTY: total не меняет вывод
      },
    };
  }

  const indeterminate = total <= 0;
  let barTotal = indeterminate ? 1 : total;
  const bar = new SingleBar(
    {
      format: indeterminate
        ? `${label} | {value} шаг.{countersText}`
        : `${label} [{bar}] {percentage}% | {value}/{total} | ETA {eta_formatted}{countersText}`,
      hideCursor: true,
      clearOnComplete: true,
      forceRedraw: process.platform === "win32",
      linewrap: false,
    },
    Presets.shades_classic,
  );
  bar.start(indeterminate ? 1 : barTotal, 0, { countersText: "" });
  options?.onActiveChange?.(true);

  return {
    tick(delta = 1, next) {
      value += delta;
      if (next) counters = { ...counters, ...next };
      bar.update(value, { countersText: formatCounters(counters) });
    },
    update(next) {
      counters = { ...counters, ...next };
      bar.update(value, { countersText: formatCounters(counters) });
    },
    setTotal(newTotal) {
      if (indeterminate || newTotal <= barTotal) return;
      barTotal = newTotal;
      bar.setTotal(newTotal);
    },
    stop() {
      if (!indeterminate) {
        bar.update(Math.min(value, barTotal), { countersText: formatCounters(counters) });
      }
      bar.stop();
      options?.onActiveChange?.(false);
    },
  };
}

/** Последовательные фазы CLI: один активный бар на stage. */
export type StageProgressReporter = {
  start(stage: string, total: number): StageProgressHandle;
};

export type StageProgressHandle = {
  tick(delta?: number, counters?: ProgressCounters): void;
  done(): void;
};

export function createStageProgressReporter(
  options?: CreateProgressOptions,
): StageProgressReporter {
  let active: ProgressHandle | null = null;

  return {
    start(stage, total) {
      active?.stop();
      active = createProgress(stage, total, options);
      return {
        tick(delta, counters) {
          active?.tick(delta, counters);
        },
        done() {
          active?.stop();
          active = null;
        },
      };
    },
  };
}
