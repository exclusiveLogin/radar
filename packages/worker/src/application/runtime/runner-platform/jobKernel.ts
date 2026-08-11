/**
 * ---
 * layer: worker/runtime
 * domain: runner-platform
 * purpose: Точка сборки generic-раннера job'а: schedule + lock + cursor + pipeline callbacks +
 *          telemetry. Реализует комбайн `ingest -> run -> materialize` из исходного плана без
 *          знания домена — весь смысл конкретного pipeline приходит через `PipelineCallbacks`.
 *          Функциональная композиция (без классовой Runner-иерархии) — job kernel не знает ни про
 *          workbook, ни про ODP.
 * ---
 */
import { randomUUID } from "node:crypto";
import { createCursorEngine, type CursorStore } from "./cursorEngine.js";
import { createLockEngine } from "./lockEngine.js";
import { createScheduleEngine } from "./scheduleEngine.js";
import type {
  PipelineCallbacks,
  RunControlReader,
  ScheduleMode,
  SignalEnvelope,
} from "./runnerContracts.js";
export type JobKernelObsPort = {
  onRunning?(): void;
  onPaused?(): void;
  onStopped?(): void;
  onTickStart?(): void;
  onTickEnd?(metrics?: Record<string, unknown>): void;
  onMaterialize?(): void;
  onLiveMetrics?(metrics: Record<string, unknown>): void;
  /** Тик нашёл работу — composition может markBusy для cascade. */
  onBusy?(): void | Promise<void>;
  /** Тик увидел пустую очередь — composition решает, публиковать ли stabilized. */
  onIdle?(): void | Promise<void>;
};

export type JobKernelStatus = {
  pipelineKey: string;
  isRunning: boolean;
  isPaused: boolean;
};

export type JobKernelConfig<TCursor, TSlice, TArtifact> = {
  pipelineKey: string;
  schedule: { mode: ScheduleMode; intervalMs?: number };
  cursorStore: CursorStore<TCursor>;
  callbacks: PipelineCallbacks<TCursor, TSlice, TArtifact>;
  /** Кооперативный control (pause/cancel) — источник хранения (DB/memory) решает вызывающая сторона. */
  readControl?: RunControlReader;
  onUnhandledError?: (error: unknown) => void;
  /** Optional observability port; mill не знает recorder или метрики. */
  obs?: JobKernelObsPort;
};

export type JobKernel = {
  start: () => void;
  stop: () => void;
  runOnce: () => Promise<void>;
  /** Новое событие/enqueue — будит цикл, если раннер простаивал. */
  enqueue: () => void;
  pause: () => void;
  resume: () => void;
  getStatus: () => JobKernelStatus;
};

export function createJobKernel<TCursor, TSlice, TArtifact>(
  config: JobKernelConfig<TCursor, TSlice, TArtifact>,
): JobKernel {
  const lockEngine = createLockEngine();
  const cursorEngine = createCursorEngine(config.cursorStore);
  const readControl: RunControlReader = config.readControl ?? (async () => "continue");
  let paused = false;

  async function tick(): Promise<void> {
    if (paused) return;
    const handle = lockEngine.tryAcquire(config.pipelineKey);
    if (!handle) return;
    config.obs?.onTickStart?.();
    try {
      const cursor = await cursorEngine.current();
      const { slice, isEmpty } = await config.callbacks.loadSlice(cursor);
      if (isEmpty) {
        await config.obs?.onIdle?.();
        config.obs?.onTickEnd?.({ empty: true });
        return;
      }

      await config.obs?.onBusy?.();
      const runId = randomUUID();
      const { artifact, nextCursor } = await config.callbacks.evaluate(slice, {
        checkControl: readControl,
      });
      await config.callbacks.materialize(artifact);
      config.obs?.onMaterialize?.();
      await cursorEngine.advance(nextCursor);

      if (config.callbacks.emitProgress) {
        const envelope: SignalEnvelope<TArtifact> = {
          pipelineKey: config.pipelineKey,
          runId,
          at: new Date().toISOString(),
          policy: { durable: true, persist: false, ephemeral: false },
          payload: artifact,
        };
        await config.callbacks.emitProgress(envelope);
      }
      config.obs?.onTickEnd?.({ runId, pipelineKey: config.pipelineKey });
    } catch (error) {
      config.onUnhandledError?.(error);
      config.obs?.onTickEnd?.({
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      handle.release();
    }
  }

  const schedule = createScheduleEngine({
    mode: config.schedule.mode,
    intervalMs: config.schedule.intervalMs,
    onTick: tick,
  });

  return {
    start: () => {
      schedule.start();
      config.obs?.onRunning?.();
    },
    stop: () => {
      schedule.stop();
      config.obs?.onStopped?.();
    },
    runOnce: () => schedule.runOnce(),
    enqueue: () => schedule.wake(),
    pause: () => {
      paused = true;
      config.obs?.onPaused?.();
    },
    resume: () => {
      paused = false;
      config.obs?.onRunning?.();
      schedule.wake();
    },
    getStatus: (): JobKernelStatus => ({
      pipelineKey: config.pipelineKey,
      isRunning: schedule.isRunning,
      isPaused: paused,
    }),
  };
}
