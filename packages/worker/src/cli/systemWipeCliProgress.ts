import type { WipeStepReporter } from "../application/archive/wipeStepReporter.js";
import { createWipeLogger, type WipeLogger } from "../application/archive/wipeLog.js";

const PHASE_ACTIONS: Record<string, string[]> = {
  "ingest-parse": [
    "phase_runs + очереди",
    "read-model карты",
    "parsed_events, parse_attempts, jobs, phase_runs",
    "ingest cursors/backfill, domain_events",
    "raw_messages",
  ],
  "geo-places": [
    "phase_runs (geo)",
    "unlink FK",
    "places + зависимости",
  ],
  "geo-catalog": [
    "unlink FK",
    "geo-каталог (regions, geo_feature, …)",
  ],
};

function formatStep(label: string, rows: number, durationMs: number): string {
  const rowsLabel = rows >= 0 ? `rows=${rows}` : "truncated";
  return `  ${label}: ${rowsLabel} (${(durationMs / 1000).toFixed(1)}s)`;
}

export type SystemWipeReporterOptions = {
  verbose?: boolean;
};

/** CLI: текстовые шаги + WipeLogger. */
export function createSystemWipeReporter(
  options: SystemWipeReporterOptions = {},
): WipeStepReporter {
  const log = createWipeLogger(options.verbose ?? false);

  return {
    log,
    phaseBegin(phase, index, total) {
      log.phase(phase, index, total, PHASE_ACTIONS[phase] ?? ["…"]);
    },
    stepBegin(label) {
      console.log(`[system:wipe]   → ${label}...`);
    },
    stepDone(label, rows, durationMs) {
      console.log(`[system:wipe] ${formatStep(label, rows, durationMs)}`);
    },
    phaseDone(phase, durationMs) {
      log.line(
        `фаза ${phase} готова (${(durationMs / 1000).toFixed(1)}s)`,
      );
    },
    finish(totalMs) {
      log.line(`═══════════════════════════════════════════════════════`);
      log.line(`ГОТОВО за ${(totalMs / 1000).toFixed(1)}s`);
      log.line(`═══════════════════════════════════════════════════════`);
    },
  };
}

export type { WipeLogger };
