import { resolveRawMessagePostedAtOrder } from "@radar/shared";
import type { PhaseIngestFlowDeps } from "./phaseIngestFlow.js";
import { runPostIngestPhaseFlow } from "./phaseIngestFlow.js";
import { MapStateFullReset } from "../map-state/mapStateFullReset.js";
import { clearParseLayerArtifacts } from "./pipelineOperationalReset.js";
import type { PhaseOperationalDeps } from "./phaseOperationalDeps.js";

export { clearParsedArtifacts } from "./pipelineOperationalReset.js";

export type FullReparseInput = {
  deps: PhaseOperationalDeps;
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
 * Полный reparse: сброс карты + wipe parsed/workspace,
 * затем planPending(ids) по каждому raw (без inline handle).
 */
export async function runFullReparseLikeIngest(input: FullReparseInput): Promise<FullReparseResult> {
  const ingestPhases = await input.deps.phaseDefinitions.listEnabled(undefined, "ingestParse");
  const phaseIds = ingestPhases.map((p) => p.id);

  const mapReset = new MapStateFullReset({
    operationalSql: input.deps.operationalSql,
  });
  const mapResetResult = await mapReset.run(new Date(), "reparse:invalidate");

  const parseLayer = await clearParseLayerArtifacts(input.deps.operationalSql, {
    forceLocks: input.forceLocks,
  });

  // Не открываем очередь до конца bulk plan — иначе daemon гоняется с CLI.
  if (phaseIds.length > 0) {
    await input.deps.phaseCoverage.clearQueuedWork(phaseIds);
  }

  const postedOrder = resolveRawMessagePostedAtOrder();
  const rows = await input.deps.operationalSql.query<{ id: string }>(
    `SELECT id FROM mat_ingest_raw ORDER BY posted_at ${postedOrder}`,
  );

  let index = 0;
  for (const row of rows) {
    input.onMessage?.(index, rows.length, row.id);
    await runPostIngestPhaseFlow(input.ingestFlow, row.id);
    index += 1;
  }

  let phasesInvalidated = 0;
  if (phaseIds.length > 0) {
    phasesInvalidated = await input.deps.phaseCoverage.invalidateForPhases(phaseIds);
    for (const phaseId of phaseIds) {
      await input.deps.phaseCoverage.enqueueCatchUp(phaseId);
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