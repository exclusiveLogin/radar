import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { DadataEnricher } from "../infrastructure/enrichers/dadataEnricher.js";
import { loadDadataToken, isDadataConfigured } from "../infrastructure/enrichers/dadataConfig.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { PlaceEnrichmentRunner } from "../application/geo-parse/placeEnrichmentRunner.js";

/**
 * Трассировка: реальный HTTP DaData для одного place из очереди geo-dadata.
 */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const token = loadDadataToken();
  console.log("token present:", Boolean(token), "len:", token?.length ?? 0);

  const runtime = await createWorkerCompositionRoot({
    storageMode: WorkerStorageMode.Db,
    startIngestParseDaemon: false,
  });
  if (!runtime.dataSource || !runtime.workerRepos || !runtime.placeEnrichmentRunner) {
    throw new Error("db mode required");
  }

  const row = (await runtime.dataSource.query(
    `SELECT j.id AS job_id, j.place_id, p.name, p.name_with_type, r.name AS region_name
     FROM job_geo_place_enrich j
     JOIN places p ON p.id = j.place_id
     JOIN regions r ON r.id = p.region_id
     WHERE j.provider = 'dadata' AND j.status = 'pending'
     LIMIT 1`,
  )) as Array<{
    job_id: string;
    place_id: string;
    name: string;
    name_with_type: string | null;
    region_name: string;
  }>;

  if (row.length === 0) {
    console.log("no pending dadata jobs — берём любой active place");
    const place = (await runtime.dataSource.query(
      `SELECT p.id, p.name, p.name_with_type, r.name AS region_name
       FROM places p JOIN regions r ON r.id = p.region_id
       WHERE p.is_active AND p.kind <> 'region' LIMIT 1`,
    )) as Array<{ id: string; name: string; name_with_type: string | null; region_name: string }>;
    const p = place[0];
    const query = [p.name_with_type ?? p.name, p.region_name].filter(Boolean).join(", ");
    await traceHttp(token, query);
    await runtime.shutdown?.();
    return;
  }

  const sample = row[0];
  const query = [sample.name_with_type ?? sample.name, sample.region_name]
    .filter(Boolean)
    .join(", ");
  console.log("sample job:", sample.job_id, "place:", sample.name, "query:", JSON.stringify(query));

  await traceHttp(token, query);

  console.log("\n--- runBatch(limit=1) через PlaceEnrichmentRunner ---");
  const runner = runtime.placeEnrichmentRunner as PlaceEnrichmentRunner;
  const batch = await runner.runBatch("dadata", 1, { phaseId: "geo-dadata" });
  console.log("batch result:", batch);

  await runtime.shutdown?.();
}

async function traceHttp(token: string | undefined, query: string): Promise<void> {
  if (!isDadataConfigured()) {
    console.log("FAIL: DADATA_TOKEN empty — enrich() returns null БЕЗ HTTP");
    return;
  }
  const enricher = new DadataEnricher(token);
  const t0 = Date.now();
  const hit = await enricher.enrich({ rawText: query });
  console.log(`enrich() ${Date.now() - t0}ms →`, hit ? { placeName: hit.placeName, lat: hit.lat, lon: hit.lon } : null);

  const controller = new AbortController();
  const response = await fetch(
    "https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address",
    {
      method: "POST",
      headers: {
        Authorization: `Token ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, count: 1 }),
      signal: controller.signal,
    },
  );
  console.log("raw HTTP status:", response.status, response.statusText);
  const body = (await response.json()) as { suggestions?: unknown[] };
  console.log("suggestions count:", body.suggestions?.length ?? 0);
  if (body.suggestions?.[0]) {
    console.log("first suggestion keys:", Object.keys(body.suggestions[0] as object));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
