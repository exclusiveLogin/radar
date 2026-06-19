import type { IPhaseDefinitionRepository, PhaseDefinitionRecord } from "@radar/shared";
import { loadPhaseManifest } from "../../infrastructure/manifest/phaseManifestLoader.js";
import { sortPhasesByOrder } from "../phases/phaseOrder.js";

/** Fallback, если манифест недоступен (только eager catalog). */
function defaultCatalogPhase(): PhaseDefinitionRecord[] {
  const updatedAt = new Date().toISOString();
  return [
    {
      id: "catalog",
      trigger: "eager",
      scope: "ingestParse",
      enrichers: ["catalog"],
      policy: { batchSize: 100, intervalMs: 60_000, concurrency: 1, minIntervalMs: 0, eagerMode: "inline" },
      enabled: true,
      order: 0,
      updatedAt,
    },
  ];
}

function manifestEntriesToRecords(
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

function loadFromManifestFile(
  repoRoot: string,
  includeDisabled: boolean,
): PhaseDefinitionRecord[] {
  const manifest = loadPhaseManifest(repoRoot);
  if (!manifest) {
    return defaultCatalogPhase();
  }
  const ingest = manifest.phases.filter((phase) => phase.scope === "ingestParse");
  const filtered = includeDisabled ? ingest : ingest.filter((phase) => phase.enabled);
  return sortPhasesByOrder(manifestEntriesToRecords(filtered));
}

/**
 * Все ingestParse-фазы из манифеста (включая enabled:false) — для CLI `--phases` override.
 */
export async function loadAllIngestParsePhases(input: {
  repoRoot: string;
  phaseDefinitions?: IPhaseDefinitionRepository;
}): Promise<PhaseDefinitionRecord[]> {
  if (input.phaseDefinitions) {
    const fromDb = await loadFromDb(input.phaseDefinitions, true);
    if (fromDb.length > 0) return fromDb;
  }
  return loadFromManifestFile(input.repoRoot, true);
}

/**
 * SSOT: enabled ingestParse-фазы (prod / snap — без override).
 * DB → `.radar/phase.manifest.json`.
 */
export async function loadIngestParsePhases(input: {
  repoRoot: string;
  phaseDefinitions?: IPhaseDefinitionRepository;
}): Promise<PhaseDefinitionRecord[]> {
  if (input.phaseDefinitions) {
    const fromDb = await loadFromDb(input.phaseDefinitions, false);
    if (fromDb.length > 0) return fromDb;
  }
  return loadFromManifestFile(input.repoRoot, false);
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
 * - default: `{ kind: "manifest" }` — enabled из манифеста
 * - CLI `--phases=llm,dadata`: `{ kind: "phase-ids", ... }` — override (включая enabled:false)
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
