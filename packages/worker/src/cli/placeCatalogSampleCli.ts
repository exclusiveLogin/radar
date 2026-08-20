import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { cliWorkerRuntime } from "./cliWorkerRuntime.js";

type Row = Record<string, unknown>;

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const runtime = await createWorkerCompositionRoot(cliWorkerRuntime("geo", ["geo"]));
  if (!runtime.dataSource) {
    console.error("place-catalog-sample: нужен db");
    process.exit(1);
  }
  const ds = runtime.dataSource;

  const sections: Array<{ title: string; sql: string }> = [
    {
      title: "По trust / evidence (active, не region)",
      sql: `
        SELECT trust_state, is_trusted,
               CASE WHEN fias_id IS NOT NULL THEN 'has_fias' ELSE 'no_fias' END AS fias,
               COUNT(*)::int AS n
        FROM places
        WHERE is_active AND kind <> 'region'
        GROUP BY 1,2,3
        ORDER BY n DESC`,
    },
    {
      title: "24/7 places и jobs",
      sql: `
        SELECT
          (SELECT COUNT(*)::int FROM places WHERE is_active AND name ~* '\\s24\\s*/\\s*7') AS active_247,
          (SELECT COUNT(*)::int FROM places WHERE NOT is_active AND name ~* '\\s24\\s*/\\s*7') AS inactive_247,
          (SELECT COUNT(*)::int FROM job_geo_place_enrich j
           JOIN places p ON p.id = j.place_id
           WHERE p.name ~* '\\s24\\s*/\\s*7' AND j.status IN ('pending','processing')) AS jobs_pending_247,
          (SELECT COUNT(*)::int FROM job_geo_place_enrich j
           JOIN places p ON p.id = j.place_id
           WHERE p.name ~* '\\s24\\s*/\\s*7') AS jobs_total_247`,
    },
    {
      title: "Pending jobs на 24/7 (sample)",
      sql: `
        SELECT p.name, r.name AS region, p.is_active, j.status, j.provider
        FROM job_geo_place_enrich j
        JOIN places p ON p.id = j.place_id
        JOIN regions r ON r.id = p.region_id
        WHERE p.name ~* '\\s24\\s*/\\s*7' AND j.status IN ('pending','processing')
        LIMIT 8`,
    },
    {
      title: "Подозрительные имена (active)",
      sql: `
        SELECT p.name, r.name AS region_name, p.trust_state, p.fias_id IS NOT NULL AS has_fias,
               COALESCE(jsonb_array_length(p.evidence_providers), 0) AS ev_n
        FROM places p
        JOIN regions r ON r.id = p.region_id
        WHERE p.is_active AND p.kind <> 'region'
          AND (
            p.name ~* '\\s24\\s*/\\s*7'
            OR length(p.name) > 50
            OR p.name ~* 'телеграм|ракет|всу|тревог|подписыв'
          )
        ORDER BY length(p.name) DESC
        LIMIT 15`,
    },
    {
      title: "Кандидаты heal: unverified без FIAS (sample)",
      sql: `
        SELECT p.name, r.name AS region_name, p.kind,
               p.evidence_providers::text AS providers,
               p.centroid_lat, p.centroid_lon
        FROM places p
        JOIN regions r ON r.id = p.region_id
        WHERE p.is_active AND p.kind <> 'region'
          AND NOT p.is_trusted
          AND p.fias_id IS NULL
          AND NOT (p.last_source_revision IS NOT NULL AND p.trust_state = 'verified')
        ORDER BY p.updated_at DESC
        LIMIT 20`,
    },
    {
      title: "Inactive недавно (heal deprecated)",
      sql: `
        SELECT p.name, r.name AS region_name, p.trust_state, p.deprecated_at
        FROM places p
        JOIN regions r ON r.id = p.region_id
        WHERE NOT p.is_active
        ORDER BY p.deprecated_at DESC NULLS LAST
        LIMIT 10`,
    },
    {
      title: "Дубли name_normalized в одном region",
      sql: `
        SELECT p.region_id, r.name AS region_name, p.name_normalized, COUNT(*)::int AS n,
               array_agg(p.name ORDER BY p.is_active DESC, p.created_at) AS names
        FROM places p
        JOIN regions r ON r.id = p.region_id
        WHERE p.kind <> 'region'
        GROUP BY p.region_id, r.name, p.name_normalized
        HAVING COUNT(*) > 1
        ORDER BY n DESC
        LIMIT 10`,
    },
    {
      title: "Active без координат, не vendor",
      sql: `
        SELECT COUNT(*)::int AS n
        FROM places p
        WHERE p.is_active AND p.kind <> 'region'
          AND p.centroid_lat IS NULL
          AND NOT (p.last_source_revision IS NOT NULL AND p.trust_state = 'verified' AND p.is_trusted)`,
    },
    {
      title: "Дубли только среди active",
      sql: `
        SELECT COUNT(*)::int AS dup_groups,
               COALESCE(SUM(cnt - 1), 0)::int AS extra_duplicate_rows
        FROM (
          SELECT COUNT(*)::int AS cnt
          FROM places
          WHERE is_active AND kind <> 'region'
          GROUP BY region_id, name_normalized
          HAVING COUNT(*) > 1
        ) t`,
    },
    {
      title: "Jobs на active без dadata evidence",
      sql: `
        SELECT COUNT(*)::int AS places_no_dadata,
               (SELECT COUNT(*)::int FROM job_geo_place_enrich j
                WHERE j.provider = 'dadata' AND j.status IN ('pending','processing')) AS dadata_pending
        FROM places p
        WHERE p.is_active AND p.kind <> 'region'
          AND NOT COALESCE(p.evidence_providers, '[]'::jsonb) @> '"dadata"'::jsonb`,
    },
  ];

  for (const { title, sql } of sections) {
    console.log(`\n=== ${title} ===`);
    const rows = (await ds.query(sql)) as Row[];
    console.log(JSON.stringify(rows, null, 2));
  }

  await runtime.shutdown?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
