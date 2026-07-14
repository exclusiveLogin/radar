/**
 * Загрузка/import/export манифеста фаз (ADR-003 v2).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { IPhaseDefinitionRepository, PhaseManifest } from "@radar/shared";
import { normalizePhaseManifestEntry, phaseManifestSchema } from "@radar/shared";

const DEFAULT_REL = path.join(".radar", "phase.manifest.json");
const BUNDLED_DEFAULT_REL = path.join("docs", "examples", "phase.manifest.default.json");

export function resolvePhaseManifestPath(repoRoot: string): string {
  const fromEnv = process.env.RADAR_PHASE_MANIFEST?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.join(repoRoot, fromEnv);
  }
  return path.join(repoRoot, DEFAULT_REL);
}

function ensurePhaseManifestFile(repoRoot: string): string | null {
  const abs = resolvePhaseManifestPath(repoRoot);
  if (fs.existsSync(abs)) return abs;

  const bundled = path.join(repoRoot, BUNDLED_DEFAULT_REL);
  if (!fs.existsSync(bundled)) return null;

  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.copyFileSync(bundled, abs);
  console.warn(`Phase manifest: создан ${DEFAULT_REL} из ${BUNDLED_DEFAULT_REL}.`);
  return abs;
}

/** Парсит манифест с нормализацией legacy kind/stage/id. */
export function loadPhaseManifest(repoRoot: string): PhaseManifest | null {
  const abs = ensurePhaseManifestFile(repoRoot);
  if (!abs) return null;
  const raw: unknown = JSON.parse(fs.readFileSync(abs, "utf8"));
  const parsed = phaseManifestSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  const legacy = raw as { phases?: Record<string, unknown>[] };
  const phases = (legacy.phases ?? []).map((entry) =>
    normalizePhaseManifestEntry(entry as Record<string, unknown>),
  );
  return { version: 1, phases };
}

export async function importPhaseManifest(
  manifest: PhaseManifest,
  repo: IPhaseDefinitionRepository,
): Promise<{ phases: number }> {
  for (const phase of manifest.phases) {
    await repo.upsert(phase);
  }
  return { phases: manifest.phases.length };
}

export async function exportPhaseManifest(
  repo: IPhaseDefinitionRepository,
): Promise<PhaseManifest> {
  const records = await repo.listAll();
  return {
    version: 1,
    phases: records.map((record) => ({
      id: record.id,
      triggerMode: record.triggerMode,
      trigger: record.trigger,
      scope: record.scope ?? "ingestParse",
      enrichers: record.enrichers,
      policy: record.policy,
      enabled: record.enabled,
      order: record.order,
    })),
  };
}

export function writePhaseManifest(repoRoot: string, manifest: PhaseManifest): string {
  const abs = resolvePhaseManifestPath(repoRoot);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(manifest, null, 2), "utf8");
  return abs;
}
