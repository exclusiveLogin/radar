import type { IPhaseDefinitionRepository, PhaseDefinitionRecord } from "@radar/shared";
import { DEFAULT_PHASE_POLICY } from "@radar/shared";
import { loadDeploymentManifest } from "@radar/shared/deployment/deploymentManifest.loader.js";
import { sortPhasesByOrder } from "../phases/phaseOrder.js";

/** Fallback, если DB пуста и deployment недоступен (только catalog). */
function defaultCatalogPhase(): PhaseDefinitionRecord[] {
  const updatedAt = new Date().toISOString();
  return [
    {
      id: "catalog",
      triggerMode: "event",
      scope: "ingestParse",
      enrichers: ["catalog"],
      policy: { ...DEFAULT_PHASE_POLICY, batchSize: 100, eagerMode: "queue" },
      enabled: true,
      order: 0,
      updatedAt,
    },
  ];
}

function toRecords(
  entries: Array<Omit<PhaseDefinitionRecord, "updatedAt"> & { updatedAt?: string }>,
): PhaseDefinitionRecord[] {
  const updatedAt = new Date().toISOString();
  return entries.map((entry) => ({ ...entry, updatedAt: entry.updatedAt ?? updatedAt }));
}

async function loadFromDb(
  phaseDefinitions: IPhaseDefinitionRepository,
  includeDisabled: boolean,
): Promise<PhaseDefinitionRecord[]> {
  const rows = includeDisabled
    ? (await phaseDefinitions.listAll()).filter((phase) => phase.scope === "ingestParse")
    : await phaseDefinitions.listEnabled(undefined, "ingestParse");
  return sortPhasesByOrder(includeDisabled ? rows : rows.filter((phase) => phase.enabled));
}

/** Fallback без DB: deployment.manifest.json.phases (не .radar/phase.manifest). */
function loadFromDeployment(repoRoot: string, includeDisabled: boolean): PhaseDefinitionRecord[] {
  try {
    const manifest = loadDeploymentManifest({ repoRoot });
    const ingest = manifest.phases.filter((phase) => phase.scope === "ingestParse");
    const filtered = includeDisabled ? ingest : ingest.filter((phase) => phase.enabled);
    return sortPhasesByOrder(toRecords(filtered));
  } catch {
    return defaultCatalogPhase();
  }
}

/**
 * Все ingestParse-фазы (включая enabled:false) — для CLI `--phases` override.
 */
export async function loadAllIngestParsePhases(input: {
  repoRoot: string;
  phaseDefinitions?: IPhaseDefinitionRepository;
}): Promise<PhaseDefinitionRecord[]> {
  if (input.phaseDefinitions) {
    const fromDb = await loadFromDb(input.phaseDefinitions, true);
    if (fromDb.length > 0) return fromDb;
  }
  return loadFromDeployment(input.repoRoot, true);
}

/**
 * SSOT: enabled ingestParse-фазы.
 * DB → deployment.manifest.phases.
 */
export async function loadIngestParsePhases(input: {
  repoRoot: string;
  phaseDefinitions?: IPhaseDefinitionRepository;
}): Promise<PhaseDefinitionRecord[]> {
  if (input.phaseDefinitions) {
    const fromDb = await loadFromDb(input.phaseDefinitions, false);
    if (fromDb.length > 0) return fromDb;
  }
  return loadFromDeployment(input.repoRoot, false);
}

/** Политика выбора фаз для offline run. */
export type IngestParsePhaseSelection =
  | { kind: "manifest" }
  | {
      kind: "phase-ids";
      /** catalog добавится автоматически, если не указан. */
      phaseIds: string[];
    };

/**
 * Выбор фаз поверх loadAllIngestParsePhases / loadIngestParsePhases.
 *
 * - default: `{ kind: "manifest" }` — enabled из DB/deployment
 * - CLI `--phases=llm,dadata`: `{ kind: "phase-ids", ... }` — override
 */
export function selectIngestParsePhases(
  pool: PhaseDefinitionRecord[],
  selection: IngestParsePhaseSelection,
): PhaseDefinitionRecord[] {
  if (selection.kind === "manifest") {
    return sortPhasesByOrder(pool.filter((phase) => phase.enabled));
  }

  const ids = new Set(selection.phaseIds);
  if (!ids.has("catalog")) {
    ids.add("catalog");
  }
  return sortPhasesByOrder(pool.filter((phase) => ids.has(phase.id)));
}