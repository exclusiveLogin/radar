import { MONOREPO_ROOT } from "@repo/root";
import { resolveGeoEnrichmentProvider } from "@radar/shared";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { loadDadataToken, isDadataConfigured } from "../infrastructure/enrichers/dadataConfig.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { cliWorkerRuntime } from "./cliWorkerRuntime.js";

/** Диагностика geo-dadata: фаза в БД, очередь, токен, sample enrich. */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const runtime = await createWorkerCompositionRoot(cliWorkerRuntime("geo", ["geo"]));
  if (!runtime.dataSource || !runtime.workerRepos) {
    throw new Error("geo-dadata check: нужен db mode");
  }

  const phase = await runtime.workerRepos.phaseDefinitions.findById("geo-dadata");
  console.log("DADATA_TOKEN configured:", isDadataConfigured());
  console.log(
    "phase geo-dadata:",
    phase
      ? {
          enabled: phase.enabled,
          scope: phase.scope,
          enrichers: phase.enrichers,
          provider: resolveGeoEnrichmentProvider(phase),
          batchSize: phase.policy.batchSize,
          intervalMs: phase.policy.intervalMs,
        }
      : "NOT IN DB — run parse-engine:manifest:import",
  );

  const counts = await runtime.dataSource.query(
    `SELECT status, COUNT(*)::int AS n
     FROM job_geo_place_enrich WHERE provider = 'dadata'
     GROUP BY status ORDER BY status`,
  );
  console.log("jobs[dadata] by status:", counts);

  const fails = await runtime.dataSource.query(
    `SELECT last_error, COUNT(*)::int AS n
     FROM job_geo_place_enrich
     WHERE provider = 'dadata' AND status = 'failed'
     GROUP BY last_error ORDER BY n DESC LIMIT 10`,
  );
  console.log("failed samples:", fails);

  const noEvidence = await runtime.dataSource.query(
    `SELECT COUNT(*)::int AS n FROM places p
     WHERE p.is_active AND p.kind <> 'region'
       AND NOT COALESCE(p.evidence_providers, '[]'::jsonb) @> to_jsonb(ARRAY['dadata']::text[])`,
  );
  console.log("active places still without dadata in evidence_providers:", noEvidence[0]?.n);

  const doneNoEvidence = await runtime.dataSource.query(
    `SELECT COUNT(*)::int AS n
     FROM job_geo_place_enrich j
     JOIN places p ON p.id = j.place_id
     WHERE j.provider = 'dadata' AND j.status = 'done'
       AND NOT COALESCE(p.evidence_providers, '[]'::jsonb) @> to_jsonb(ARRAY['dadata']::text[])`,
  );
  console.log(
    "done jobs but place still missing dadata evidence (silent no-op bug):",
    doneNoEvidence[0]?.n,
  );

  const token = loadDadataToken();
  if (token) {
    const { DadataEnricher } = await import("../infrastructure/enrichers/dadataEnricher.js");
    const enricher = new DadataEnricher(token);
    const hit = await enricher.enrich({ rawText: "Москва, Красная площадь", regionCode: "RU-MOW" });
    if (enricher.isSuggestionsBlocked()) {
      console.log(
        "live dadata probe: FAIL — SUGGESTIONS disabled (403). Включи «Подсказки» в профиле DaData или замени DADATA_TOKEN.",
      );
    } else {
      console.log(
        "live dadata probe:",
        hit ? { placeName: hit.placeName, lat: hit.lat, lon: hit.lon } : null,
      );
    }
  }

  await runtime.shutdown?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
