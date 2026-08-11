/**
 * ---
 * layer: worker/runtime
 * domain: runner-platform (cross-context, без доменных знаний)
 * purpose: Универсальные generic-контракты исполнения job'ов (tracking/parse/geo-enrich).
 *          Platform НЕ знает доменных типов конкретного pipeline — только эти callback-контракты.
 *          Домен подключается через `PipelineCallbacks<TCursor, TSlice, TArtifact>`.
 * ---
 */

import type { StepEmit } from "@radar/shared";

/** Флаги доставки сигнала — определяют, где он переживает рестарт/куда попадает. */
export type SignalPolicy = {
  /** Сохраняется для poller/replay (переживает рестарт процесса). */
  durable: boolean;
  /** Сохраняется в snapshot/read REST контур. */
  persist: boolean;
  /** Только live WS, нигде не хранится. */
  ephemeral: boolean;
};

/** Типизированный конверт сигнала — единственная форма, в которой platform говорит наружу. */
export type SignalEnvelope<TPayload> = {
  pipelineKey: string;
  phaseKey?: string;
  runId: string;
  /** ISO timestamp. */
  at: string;
  policy: SignalPolicy;
  payload: TPayload;
};

export type RunOutcome = "completed" | "canceled" | "paused" | "failed";

/** Кооперативный контроль — источник хранения (DB/memory) решает вызывающая сторона. */
export type RunControlSignal = "continue" | "pause" | "cancel";

export type RunControlReader = () => Promise<RunControlSignal>;

/** Что грузить для текущего курсора: домен решает форму `TSlice`. */
export type LoadSlice<TCursor, TSlice> = (cursor: TCursor) => Promise<{
  slice: TSlice;
  isEmpty: boolean;
}>;

/** Молотилка: чистая бизнес-логика над порцией данных, platform её не трогает. */
export type Evaluate<TSlice, TArtifact, TCursor> = (
  slice: TSlice,
  ctx: { checkControl: RunControlReader },
) => Promise<{
  artifact: TArtifact;
  nextCursor: TCursor;
  /** Wave 3+: опциональные emits для StepEgressGate (jobKernel пока игнорирует). */
  emits?: StepEmit[];
}>;

/** Материализация side-артефактов (DB/persist) — без доменной логики platform-слоя. */
export type Materialize<TArtifact> = (artifact: TArtifact) => Promise<void>;

/** Публикация прогресса наружу (WS/poller) — типизированный конверт, не сырой payload. */
export type EmitProgress<TArtifact> = (
  envelope: SignalEnvelope<TArtifact>,
) => Promise<void> | void;

/**
 * Единственная точка подключения домена к runner platform.
 * `ingest -> run -> materialize` в терминах исходного плана — это `loadSlice -> evaluate -> materialize`.
 */
export type PipelineCallbacks<TCursor, TSlice, TArtifact> = {
  loadSlice: LoadSlice<TCursor, TSlice>;
  evaluate: Evaluate<TSlice, TArtifact, TCursor>;
  materialize: Materialize<TArtifact>;
  emitProgress?: EmitProgress<TArtifact>;
};

export type ScheduleMode = "event" | "interval" | "hybrid";
