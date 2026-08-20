/**
 * ---
 * layer: worker/runtime
 * domain: runner-platform
 * purpose: Гибридный шедулер тиков job'а — event-driven `wake()` (enqueue разбудил простаивающий
 *          раннер) + interval watchdog (курсорная догонка/self-heal без событий). Совмещает и
 *          коалесцирует конкурентные тики — новый событийный wake во время выполнения не запускает
 *          параллельный тик, а планирует ровно один повторный проход после текущего.
 * ---
 */
import type { ScheduleMode } from "./runnerContracts.js";

export type ScheduleEngineOptions = {
  mode: ScheduleMode;
  /** Обязателен для `interval`/`hybrid`; игнорируется для чистого `event`. */
  intervalMs?: number;
  onTick: () => Promise<void>;
};

export type ScheduleEngine = {
  start: () => void;
  stop: () => void;
  runOnce: () => Promise<void>;
  /** Событийный триггер (новое событие/enqueue) — будит цикл вне интервала. */
  wake: () => void;
  readonly isRunning: boolean;
};

export function createScheduleEngine(opts: ScheduleEngineOptions): ScheduleEngine {
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let pendingWakeup = false;

  async function runTick(): Promise<void> {
    if (running) {
      pendingWakeup = true;
      return;
    }
    running = true;
    try {
      await opts.onTick();
    } finally {
      running = false;
      if (pendingWakeup) {
        pendingWakeup = false;
        void runTick();
      }
    }
  }

  return {
    start() {
      if (opts.mode !== "event" && opts.intervalMs) {
        timer = setInterval(() => void runTick(), opts.intervalMs);
      }
      void runTick();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    runOnce: () => runTick(),
    wake() {
      if (opts.mode === "interval") return;
      void runTick();
    },
    get isRunning() {
      return running;
    },
  };
}
