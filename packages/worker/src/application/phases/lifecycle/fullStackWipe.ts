import { wipeGeoCatalogPhase } from "./geoCatalogPhase.js";
import { wipeGeoPlacesPhase } from "./geoPhase.js";
import { wipeIngestParsePhase } from "./ingestParsePhase.js";
import { terminateOtherDatabaseBackends } from "../../archive/wipeDbLocks.js";
import type { WipeStepReporter } from "../../archive/wipeStepReporter.js";
import type { PhaseMutationResult } from "./phaseLifecycle.types.js";
import type { PhaseOperationalDeps } from "../phaseOperationalDeps.js";

export type FullStackWipeResult = {
  steps: PhaseMutationResult[];
};

/**
 * system:wipe — полный сброс контента (БД), без конфига ingest/фаз.
 */
export async function wipeFullDataStack(input: {
  deps: PhaseOperationalDeps;
  dryRun: boolean;
  reporter?: WipeStepReporter;
  /** По умолчанию true для system:wipe — закрыть dev/API подключения. */
  forceLocks?: boolean;
}): Promise<FullStackWipeResult> {
  const { reporter, forceLocks = true, ...wipeInput } = input;
  const log = reporter?.log;
  const onStep = reporter
    ? {
        stepBegin: (label: string) => reporter.stepBegin(label),
        stepDone: (label: string, rows: number, durationMs: number) =>
          reporter.stepDone(label, rows, durationMs),
      }
    : undefined;

  const stepCtx = { onStep, log, forceLocks };

  if (!input.dryRun && forceLocks) {
    log?.line("подготовка: закрытие прочих подключений к БД (forceLocks)…");
    await terminateOtherDatabaseBackends(wipeInput.deps.operationalSql, log);
  }

  if (input.dryRun) {
    return {
      steps: [
        await wipeIngestParsePhase({ ...wipeInput, ...stepCtx }),
        await wipeGeoPlacesPhase({ ...wipeInput, ...stepCtx }),
        await wipeGeoCatalogPhase({
          dryRun: true,
          ...stepCtx,
        }),
      ],
    };
  }

  const started = Date.now();
  const phases: Array<{ name: string; run: () => Promise<PhaseMutationResult> }> = [
    {
      name: "ingest-parse",
      run: () => wipeIngestParsePhase({ ...wipeInput, ...stepCtx }),
    },
    {
      name: "geo-places",
      run: () => wipeGeoPlacesPhase({ ...wipeInput, ...stepCtx }),
    },
    {
      name: "geo-catalog",
      run: () =>
        wipeGeoCatalogPhase({
          operationalSql: wipeInput.deps.operationalSql,
          dryRun: false,
          ...stepCtx,
        }),
    },
  ];

  const steps: PhaseMutationResult[] = [];
  for (let index = 0; index < phases.length; index++) {
    const phase = phases[index]!;
    reporter?.phaseBegin(phase.name, index + 1, phases.length);
    const phaseStarted = Date.now();
    steps.push(await phase.run());
    reporter?.phaseDone(phase.name, Date.now() - phaseStarted);
  }

  reporter?.finish(Date.now() - started);
  return { steps };
}
