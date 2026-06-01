import { resolveRawMessagePostedAtOrder } from "@radar/shared";
import type { DataSource } from "typeorm";
import type { WorkerDbRepositories } from "../../infrastructure/persistence/workerDbRepos.types.js";
import type { PhaseIngestFlowDeps } from "./phaseIngestFlow.js";
import { runPostIngestPhaseFlow } from "./phaseIngestFlow.js";
import { MapStateFullReset } from "../map-state/mapStateFullReset.js";
import { clearParsedArtifacts } from "./pipelineOperationalReset.js";
import { sortPhasesByOrder } from "./phaseOrder.js";

export { clearParsedArtifacts } from "./pipelineOperationalReset.js";

export type FullReparseInput = {
  dataSource: DataSource;
  repos: WorkerDbRepositories;
  ingestFlow: PhaseIngestFlowDeps;
  onMessage?: (index: number, total: number, rawMessageId: string) => void;
};

/**
 * Полный reparse: инвалидация coverage + parsed_events, затем ingest-поток по каждому raw.
 * Scheduled-фазы догоняет PhaseDaemon (после done всех eager по order).
 */
export async function runFullReparseLikeIngest(input: FullReparseInput): Promise<{
  messages: number;
  phasesInvalidated: number;
}> {
  const autoPhases = sortPhasesByOrder(
    (await input.repos.phaseDefinitions.listEnabled()).filter(
      (p) => p.trigger === "eager" || p.trigger === "scheduled",
    ),
  );
  const phaseIds = autoPhases.map((p) => p.id);

  const mapReset = new MapStateFullReset({
    regionState: input.repos.regionState,
    placeStatus: input.repos.placeStatus,
    regions: input.repos.regions,
    dataSource: input.dataSource,
  });
  await mapReset.run(new Date(), "reparse:invalidate");

  await clearParsedArtifacts(input.dataSource);
  const phasesInvalidated =
    phaseIds.length > 0
      ? await input.repos.phaseCoverage.invalidateForPhases(phaseIds)
      : 0;

  for (const phaseId of phaseIds) {
    await input.repos.phaseCoverage.enqueueCatchUp(phaseId);
  }

  const postedOrder = resolveRawMessagePostedAtOrder();
  const rows = (await input.dataSource.query(
    `SELECT id FROM raw_messages ORDER BY posted_at ${postedOrder}`,
  )) as Array<{ id: string }>;

  let index = 0;
  for (const row of rows) {
    input.onMessage?.(index, rows.length, row.id);
    await runPostIngestPhaseFlow(input.ingestFlow, row.id);
    index += 1;
  }

  return { messages: rows.length, phasesInvalidated };
}
