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
    if (!handle) return; // уже выполняется этим же процессом — коалесцируется в scheduleEngine
    try {
      const cursor = await cursorEngine.current();
      const { slice, isEmpty } = await config.callbacks.loadSlice(cursor);
      if (isEmpty) return;

      const runId = randomUUID();
      const { artifact, nextCursor } = await config.callbacks.evaluate(slice, {
        checkControl: readControl,
      });
      await config.callbacks.materialize(artifact);
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
    } catch (error) {
      config.onUnhandledError?.(error);
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
    start: () => schedule.start(),
    stop: () => schedule.stop(),
    runOnce: () => schedule.runOnce(),
    enqueue: () => schedule.wake(),
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
      schedule.wake();
    },
    getStatus: (): JobKernelStatus => ({
      pipelineKey: config.pipelineKey,
      isRunning: schedule.isRunning,
      isPaused: paused,
    }),
  };
}
