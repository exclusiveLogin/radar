import type { DeploymentManifest, IPhaseDefinitionRepository } from "@radar/shared";

export type ManifestSeedMode = "insert-only" | "apply-config";

export type ManifestSeedResult = {
  inserted: number;
  updated: number;
  skipped: number;
};

/**
 * Seed phase_definitions из deployment.manifest.json.phases.
 * apply-config обновляет конфиг, но never overwrite enabled.
 */
export async function seedPhasesFromManifest(
  manifest: DeploymentManifest,
  repo: IPhaseDefinitionRepository,
  mode: ManifestSeedMode,
): Promise<ManifestSeedResult> {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const phase of manifest.phases) {
    const existing = await repo.findById(phase.id);
    if (!existing) {
      await repo.upsert(phase);
      inserted += 1;
      continue;
    }

    if (mode === "insert-only") {
      skipped += 1;
      continue;
    }

    await repo.upsert({
      ...phase,
      enabled: existing.enabled,
    });
    updated += 1;
  }

  return { inserted, updated, skipped };
}
