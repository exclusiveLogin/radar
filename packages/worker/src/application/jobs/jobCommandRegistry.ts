import type { JobType } from "@radar/shared";

/** Команда npm-скрипта, которой исполняется задача (SSOT исполнения — CLI). */
export type JobCommand = {
  /** npm-скрипт в корне монорепы (см. package.json). */
  script: string;
  /** Аргументы после `--`. */
  args: string[];
};

function readBatch(params: Record<string, unknown>): string {
  const batch = Number(params.batch ?? params.batchSize ?? 100);
  return Number.isFinite(batch) && batch > 0 ? String(batch) : "100";
}

/**
 * Реестр типов задач → npm-команда (ADR-003, Фаза G).
 *
 * Демон не дублирует логику пайплайна: он запускает те же документированные
 * CLI, что и оператор вручную. Это и есть единый источник исполнения —
 * добавление типа = одна запись здесь + значение в `jobTypeSchema`.
 */
export const JOB_COMMANDS: Record<JobType, (params: Record<string, unknown>) => JobCommand> = {
  reparse: () => ({ script: "worker:reparse:raw", args: [] }),
  "enrich-llm": (params) => ({
    script: "worker:enrich:run",
    args: ["--stage=llm", `--batch=${readBatch(params)}`],
  }),
  "enrich-dadata": (params) => ({
    script: "worker:enrich:run",
    args: ["--stage=dadata", `--batch=${readBatch(params)}`],
  }),
  "enrich-nominatim": (params) => ({
    script: "worker:enrich:run",
    args: ["--stage=nominatim", `--batch=${readBatch(params)}`],
  }),
};

/** Строит команду для типа задачи; null — если тип не зарегистрирован. */
export function resolveJobCommand(
  type: JobType,
  params: Record<string, unknown>,
): JobCommand | null {
  const builder = JOB_COMMANDS[type];
  return builder ? builder(params) : null;
}
