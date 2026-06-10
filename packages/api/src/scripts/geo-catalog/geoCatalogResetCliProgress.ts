import { createProgress, type ProgressHandle } from "@radar/shared";
import type {
  GeoCatalogResetStepStats,
  IGeoCatalogResetReporter,
} from "../../application/geo-catalog/geo-catalog.reporter.port";

function formatStep(stats: GeoCatalogResetStepStats): string {
  return `[${stats.step}] rows=${stats.rows} (${(stats.durationMs / 1000).toFixed(1)}s)`;
}

/** CLI: progress-bar + построчный лог шагов geo:catalog:reset. */
export function createGeoCatalogResetReporter(): IGeoCatalogResetReporter {
  let bar: ProgressHandle | null = null;
  const steps: GeoCatalogResetStepStats[] = [];

  return {
    stepBegin(step, index, total) {
      console.log(`[geo:catalog:reset] [${index}/${total}] ${step}...`);
      if (!bar) {
        bar = createProgress("geo:catalog:reset", total);
      }
    },
    stepDone(stats) {
      steps.push(stats);
      console.log(`[geo:catalog:reset] ${formatStep(stats)}`);
      bar?.tick(1, { rows: stats.rows });
    },
    finish(totals, allSteps) {
      bar?.stop();
      bar = null;
      const totalMs = allSteps.reduce((sum, step) => sum + step.durationMs, 0);
      console.log(`[geo:catalog:reset] done (${(totalMs / 1000).toFixed(1)}s)`);
      console.log("[geo:catalog:reset] итого:", JSON.stringify(totals, null, 2));
    },
  };
}
