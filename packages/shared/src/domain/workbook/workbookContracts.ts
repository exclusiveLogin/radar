/**
 * ---
 * layer: shared/domain
 * domain: workbook
 * purpose: Контракты `workbook` — декларативный чертёж конвейера (phase graph + eval), который
 *          admin/web может показывать без исполнения pipeline. Чисто типы/фабрика, без Node.js
 *          зависимостей (импортируется и в worker, и в browser-safe барр shared).
 *          Способ описания — код-first: фабрика `createWorkbook()` + Rx/callback eval, без
 *          отдельного DSL/manifest-файла (см. tracking-parse-architecture-refactor plan, раздел
 *          "Workbook => Workload => Eval").
 * ---
 */

export type WorkbookPhaseDescriptor = {
  readonly id: string;
  readonly enabled: boolean;
  readonly label?: string;
  readonly triggerMode?: "event" | "timeout" | "both" | "manual";
  readonly subscribeTopic?: string;
  readonly publishTopic?: string;
};

/** Сериализуемое представление workbook — то, что видит admin/web UI (Workbook Registry). */
export type WorkbookDescriptor = {
  readonly pipelineKey: string;
  readonly phases: readonly WorkbookPhaseDescriptor[];
};

export type RunControlSignal = "continue" | "pause" | "cancel";

/**
 * `eval` — молотилка исполнения phase graph. Изолирована от runtime/queue механики (jobKernel
 * из worker/runtime), поэтому тестируется отдельно и запускается напрямую (worker/scheduler/CLI/manual).
 */
export type WorkbookEvalFn<TSlice, TArtifact, TCursor> = (
  slice: TSlice,
  ctx: { checkControl: () => Promise<RunControlSignal> },
) => Promise<{ artifact: TArtifact; nextCursor: TCursor }>;

export type WorkbookDefinition<TCursor, TSlice, TArtifact> = {
  pipelineKey: string;
  phases: readonly WorkbookPhaseDescriptor[];
  evaluate: WorkbookEvalFn<TSlice, TArtifact, TCursor>;
};

export type WorkbookInstance<TCursor, TSlice, TArtifact> = {
  readonly descriptor: WorkbookDescriptor;
  readonly evaluate: WorkbookEvalFn<TSlice, TArtifact, TCursor>;
};
