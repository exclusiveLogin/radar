import { resolveRawMessagePostedAtOrder } from "@radar/shared";
import type { DataSource } from "typeorm";
import type { WorkerDbRepositories } from "../../infrastructure/persistence/workerDbRepos.types.js";
import type { PhaseIngestFlowDeps } from "./phaseIngestFlow.js";
import { runPostIngestPhaseFlow } from "./phaseIngestFlow.js";
import { MapStateFullReset } from "../map-state/mapStateFullReset.js";
import { clearParseLayerArtifacts, clearParsedArtifacts } from "./pipelineOperationalReset.js";

export { clearParsedArtifacts } from "./pipelineOperationalReset.js";

export type FullReparseInput = {
  dataSource: DataSource;
  repos: WorkerDbRepositories;
  ingestFlow: PhaseIngestFlowDeps;
  onMessage?: (index: number, total: number, rawMessageId: string) => void;
  /** По умолчанию true — при lock timeout закрываем блокирующие dev/API сессии. */
  forceLocks?: boolean;
};

export type FullReparseResult = {
  messages: number;
  phasesInvalidated: number;
  mapPlacesCleared: number;
  mapRegionsGrey: number;
  workspacesDeleted: number;
  parsedEventsDeleted: number;
};

/**
 * Полный reparse (контур rebuild): сброс карты + wipe parsed/workspace,
 * затем ingest-flow по каждому raw с нуля.
 * @see ../parse/parseWorkspaceRunModes.ts
 */
export async function runFullReparseLikeIngest(input: FullReparseInput): Promise<FullReparseResult> {
  const [, scheduled] = await Promise.all([
    input.repos.phaseDefinitions.listEnabled("eager", "ingestParse"),
    input.repos.phaseDefinitions.listEnabled("scheduled", "ingestParse"),
  ]);
  const scheduledIds = scheduled.map((p) => p.id);

  const mapReset = new MapStateFullReset({
    dataSource: input.dataSource,
  });
  const mapResetResult = await mapReset.run(new Date(), "reparse:invalidate");

  const parseLayer = await clearParseLayerArtifacts(input.dataSource, {
    forceLocks: input.forceLocks,
  });

  // Не открываем scheduled-очередь до конца bulk reparse — иначе daemon гоняется с CLI.
  if (scheduledIds.length > 0) {
    await input.repos.phaseCoverage.clearQueuedWork(scheduledIds);
  }

  const postedOrder = resolveRawMessagePostedAtOrder();
  const rows = (await input.dataSource.query(
    `SELECT id FROM raw_messages ORDER BY posted_at ${postedOrder}`,
  )) as Array<{ id: string }>;

  let index = 0;
  for (const row of rows) {
    input.onMessage?.(index, rows.length, row.id);
    await runPostIngestPhaseFlow(input.ingestFlow, row.id, { skipCoverageEnqueue: true });
    index += 1;
  }

  let phasesInvalidated = 0;
  if (scheduledIds.length > 0) {
    phasesInvalidated = await input.repos.phaseCoverage.invalidateForPhases(scheduledIds);
    for (const phaseId of scheduledIds) {
      await input.repos.phaseCoverage.enqueueCatchUp(phaseId);
    }
  }

  return {
    messages: rows.length,
    phasesInvalidated,
    mapPlacesCleared: mapResetResult.placesCleared,
    mapRegionsGrey: mapResetResult.regionsGrey,
    workspacesDeleted: parseLayer.workspacesDeleted,
    parsedEventsDeleted: parseLayer.parsedEventsDeleted,
  };
}
