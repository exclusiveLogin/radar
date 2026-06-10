import type { WipeLogger } from "./wipeLog.js";

/** Колбэк прогресса для длительных wipe-операций. */
export type WipeStepReporter = {
  readonly log: WipeLogger;
  phaseBegin(phase: string, index: number, total: number): void;
  stepBegin(label: string): void;
  stepDone(label: string, rows: number, durationMs: number): void;
  phaseDone(phase: string, durationMs: number): void;
  finish(totalMs: number): void;
};

export type WipeStepOptions = {
  onStep?: Pick<WipeStepReporter, "stepBegin" | "stepDone">;
  log?: WipeLogger;
  /** pg_terminate_backend для dev/API перед TRUNCATE (system:wipe по умолчанию). */
  forceLocks?: boolean;
};

function formatRows(rows: number): string {
  if (rows < 0) return "truncated";
  return `${rows} rows`;
}

/** Выполняет шаг wipe с логированием и перехватом ошибок. */
export async function runWipeStep(
  ctx: WipeStepOptions,
  label: string,
  run: () => Promise<number>,
): Promise<number> {
  const started = Date.now();
  ctx.onStep?.stepBegin(label);
  ctx.log?.detail(`▶ ${label}`);

  try {
    const rows = await run();
    const durationMs = Date.now() - started;
    ctx.log?.detail(`✓ ${label} — ${formatRows(rows)} (${(durationMs / 1000).toFixed(2)}s)`);
    ctx.onStep?.stepDone(label, rows, durationMs);
    return rows;
  } catch (error) {
    const durationMs = Date.now() - started;
    const message = error instanceof Error ? error.message : String(error);
    ctx.log?.line(`✗ ОШИБКА «${label}» после ${(durationMs / 1000).toFixed(1)}s: ${message}`);
    throw error;
  }
}
