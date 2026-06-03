import type { DataSource } from "typeorm";
import type { WorkerDbRepositories } from "../../../infrastructure/persistence/workerDbRepos.types.js";
import { wipeGeoCatalogPhase } from "./geoCatalogPhase.js";
import { wipeGeoPlacesPhase } from "./geoPhase.js";
import { wipeIngestParsePhase } from "./ingestParsePhase.js";
import type { PhaseMutationResult } from "./phaseLifecycle.types.js";

export type FullStackWipeResult = {
  steps: PhaseMutationResult[];
};

/**
 * vendor-ingest-parse-geo:wipe — полный сброс контента (БД), без конфига ingest/фаз.
 */
export async function wipeFullDataStack(input: {
  dataSource: DataSource;
  repos: WorkerDbRepositories;
  dryRun: boolean;
}): Promise<FullStackWipeResult> {
  if (input.dryRun) {
    return {
      steps: [
        await wipeIngestParsePhase(input),
        await wipeGeoPlacesPhase(input),
        await wipeGeoCatalogPhase({ dataSource: input.dataSource, dryRun: true }),
      ],
    };
  }

  const ingestParse = await wipeIngestParsePhase(input);
  const geoPlaces = await wipeGeoPlacesPhase(input);
  const geoCatalog = await wipeGeoCatalogPhase({
    dataSource: input.dataSource,
    dryRun: false,
  });

  return { steps: [ingestParse, geoPlaces, geoCatalog] };
}
