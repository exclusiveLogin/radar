/**
 * ---
 * layer: worker/cli
 * kind: utility
 * purpose: Единый live progress-UI для длительных CLI (reparse, backfill, A/B, scorer).
 * ---
 *
 * Тонкая обёртка над `cli-progress`: один single-line бар с ETA и счётчиками.
 * SSOT формата прогресса — потребители не настраивают пресет руками.
 * В не-TTY (CI, pipe в файл) бар не рисуется, печатаются редкие текстовые вехи.
 */
import { Presets, SingleBar } from "cli-progress";

/** Доп. счётчики, отображаемые в строке бара (например ok/failed). */
export type ProgressCounters = Record<string, number>;

/** Управление активным прогресс-баром (инкремент/обновление/финал). */
export type ProgressHandle = {
  /** Сдвинуть прогресс на `delta` (по умолчанию 1) и обновить счётчики. */
  tick(delta?: number, counters?: ProgressCounters): void;
  /** Обновить только дополнительные счётчики без сдвига прогресса. */
  update(counters: ProgressCounters): void;
  /** Завершить бар (дорисовать до total, остановить рендер). */
  stop(): void;
};

const isTty = Boolean(process.stdout.isTTY);

function formatCounters(counters: ProgressCounters | undefined): string {
  if (!counters) return "";
  const parts = Object.entries(counters).map(([key, value]) => `${key}=${value}`);
  return parts.length > 0 ? ` | ${parts.join(" ")}` : "";
}

/**
 * Создаёт прогресс-бар для процесса из `total` шагов.
 * `label` — короткое имя процесса в начале строки.
 */
export function createProgress(label: string, total: number): ProgressHandle {
  let value = 0;
  let counters: ProgressCounters = {};

  if (!isTty) {
    // Не-TTY: текстовые вехи на 10% без перерисовки строки.
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
        value = total;
        log();
      },
    };
  }

  const bar = new SingleBar(
    {
      format: `${label} [{bar}] {percentage}% | {value}/{total} | ETA {eta_formatted}{countersText}`,
      hideCursor: true,
      clearOnComplete: false,
    },
    Presets.shades_classic,
  );
  bar.start(total, 0, { countersText: "" });

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
    stop() {
      bar.update(total, { countersText: formatCounters(counters) });
      bar.stop();
    },
  };
}
