import { existsSync } from "node:fs";
import { join } from "node:path";
import { ingestManifestSchema, type IngestManifest } from "../../schemas/ingest/ingest-manifest.js";
import { loadDomainManifest } from "../loadDomainManifest.js";

export type LoadIngestManifestOptions = {
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
};

const DEFAULT_INGEST_MANIFEST: IngestManifest = ingestManifestSchema.parse({ version: 2, entries: [] });

/** Резолв пути ingest manifest: env → ingest.manifest.json → BC .radar/ingest.manifest.json */
export function resolveIngestManifestPath(repoRoot: string, env = process.env): string {
  const fromEnv = env.RADAR_INGEST_MANIFEST?.trim();
  if (fromEnv) {
    return fromEnv.startsWith("/") || /^[A-Za-z]:/.test(fromEnv)
      ? fromEnv
      : join(repoRoot, fromEnv);
  }
  const canonical = join(repoRoot, "ingest.manifest.json");
  if (existsSync(canonical)) return canonical;
  return join(repoRoot, ".radar", "ingest.manifest.json");
}

/** Загрузка ingest manifest через generic loader + INGEST__ env. */
export function loadIngestManifestFromDomain(
  options: LoadIngestManifestOptions,
): IngestManifest {
  const canonical = join(options.repoRoot, "ingest.manifest.json");
  const legacy = join(options.repoRoot, ".radar", "ingest.manifest.json");
  const baseManifestPath = existsSync(canonical)
    ? canonical
    : existsSync(legacy)
      ? legacy
      : canonical;

  return loadDomainManifest<IngestManifest>({
    repoRoot: options.repoRoot,
    env: options.env,
    fileBase: "ingest",
    envPrefix: "INGEST",
    schema: ingestManifestSchema,
    defaults: DEFAULT_INGEST_MANIFEST,
    baseManifestPath,
  });
}
