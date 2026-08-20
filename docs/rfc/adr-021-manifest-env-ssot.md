# ADR-021: Manifest ↔ Env SSOT

## Статус

Принято.

## Контекст

Конфигурация размазана по `deployment.manifest.json`, legacy `DEPLOY_*` / `DOCKERIZE_*` / `*_RUNNER_PLATFORM_ENABLED` и прямым `process.env` в рантайме. Три канала на одно решение → непредсказуемый override.

## Решение

Единая цепочка для **каждого домена**:

```
DEFAULT (TypeScript)
 → {domain}.manifest.json
  → {domain}.local.manifest.json (gitignore)
   → {DOMAIN}__nested__path=value (env, побеждает всё)
    → resolved config (единственный вход в код)
```

### Generic loader (`packages/shared/src/manifest/`)

| Модуль | Назначение |
|--------|------------|
| `loadDomainManifest.ts` | merge chain + zod validate |
| `applyEnvOverlay.ts` | `PREFIX__seg__seg=value` |
| `parseEnvValue.ts` | явные `true`/`false`/`0`/number/string |
| `deepMergeJson.ts` | keyed arrays (`pipelineKey` и т.п.) |

### Домены

| Домен | Файл | Env prefix |
|-------|------|------------|
| deployment | `deployment.manifest.json` | `DEPLOY__` |
| worker.runtime | `worker.runtime.manifest.json` | `WORKER__` |
| geo.enrichers | `geo.enrichers.manifest.json` | `GEO__` |
| ingest | `ingest.manifest.json` (BC: `.radar/ingest.manifest.json`) | `INGEST__` |

### Примеры env

```bash
DEPLOY__runners__pipelines__tracking__schedulingImpl=runner-platform
DEPLOY__infra__obs__dockerize=true
DEPLOY__process__role=phase
WORKER__backfill__pollMs=20000
GEO__llm__enabled=0
```

### Что остаётся только в `.env`

Секреты (`DADATA_TOKEN`, `POSTGRES_PASSWORD`), `DATABASE_URL`, `VITE_*`, `NODE_ENV`.

## Последствия

- Удалены: `applyDeploymentEnvOverlay`, `applyDeploymentInfraEnv`, `DEPLOY_PIPELINE_*`, `*_RUNNER_PLATFORM_ENABLED` как каналы решения.
- `resolveObsConfig(manifest.infra.obs)` — obs write/read без `DOCKERIZE_OBS` / `RADAR_OBS_MODE`.
- Скрипты `dev-stack` / `cold-up` / `radar stack docker-dev` читают `manifest.infra.obs.dockerize`.

## См. также

- [ADR-018](adr-018-deployment-manifest.md)
