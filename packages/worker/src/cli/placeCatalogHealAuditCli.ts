import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { isGarbageIngestPlaceName } from "../domain/parsing/channelCityListPromo.js";
import {
  isPlaceCatalogHealCandidate,
  isVendorCatalogPlace,
} from "../domain/parsing/placeCatalogHealRule.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";

export type PlaceCatalogAuditSnapshot = {
  activeTotal: number;
  activeNonRegion: number;
  inactiveTotal: number;
  vendorProtected: number;
  regionPlaces: number;
  healCandidates: number;
  garbageName: number;
  unverifiedNoFias: number;
  llmOnlyEvidence: number;
  rejectedTrust: number;
  pendingGeoJobs: number;
};

/** Снимок качества каталога places (без изменений БД). */
export async function snapshotPlaceCatalogAudit(
  dataSource: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  places: Awaited<
    ReturnType<
      NonNullable<Awaited<ReturnType<typeof createWorkerCompositionRoot>>["workerRepos"]>["places"]["listActive"]
    >
  >,
): Promise<PlaceCatalogAuditSnapshot> {
  let healCandidates = 0;
  let garbageName = 0;
  let unverifiedNoFias = 0;
  let llmOnlyEvidence = 0;
  let rejectedTrust = 0;
  let vendorProtected = 0;
  let regionPlaces = 0;
  let activeNonRegion = 0;

  for (const place of places) {
    if (place.kind === "region") {
      regionPlaces += 1;
      continue;
    }
    activeNonRegion += 1;
    if (isVendorCatalogPlace(place)) {
      vendorProtected += 1;
    }
    if (isGarbageIngestPlaceName(place.name)) {
      garbageName += 1;
    }
    if (place.trustState === "rejected") {
      rejectedTrust += 1;
    }
    if (!place.isTrusted && !place.fiasId) {
      unverifiedNoFias += 1;
    }
    const providers = place.evidenceProviders ?? [];
    if (providers.length === 1 && providers[0] === "llm") {
      llmOnlyEvidence += 1;
    }
    if (isPlaceCatalogHealCandidate(place, "candidates")) {
      healCandidates += 1;
    }
  }

  const inactiveRows = (await dataSource.query(
    `SELECT COUNT(*)::int AS c FROM places WHERE is_active = false`,
  )) as Array<{ c: number }>;
  const jobsRows = (await dataSource.query(
    `SELECT COUNT(*)::int AS c FROM job_geo_place_enrich WHERE status IN ('pending', 'processing')`,
  )) as Array<{ c: number }>;

  return {
    activeTotal: places.length,
    activeNonRegion,
    inactiveTotal: inactiveRows[0]?.c ?? 0,
    vendorProtected,
    regionPlaces,
    healCandidates,
    garbageName,
    unverifiedNoFias,
    llmOnlyEvidence,
    rejectedTrust,
    pendingGeoJobs: jobsRows[0]?.c ?? 0,
  };
}

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const runtime = await createWorkerCompositionRoot({
    storageMode: WorkerStorageMode.Db,
    startIngestParseDaemon: false,
  });
  if (!runtime.dataSource || !runtime.workerRepos) {
    console.error("catalog:heal:audit: нужен RADAR_STORAGE_MODE=db");
    process.exit(1);
  }

  const places = await runtime.workerRepos.places.listActive();
  const snapshot = await snapshotPlaceCatalogAudit(runtime.dataSource, places);
  console.log(JSON.stringify(snapshot, null, 2));
  await runtime.shutdown?.();
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("placeCatalogHealAuditCli.ts");
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
