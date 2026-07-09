# ADR-018: Deployment manifest (Iter 4)

**Статус:** accepted  
**Дата:** 2026-07-09  
**Связано:** [ADR-017](./adr-017-observability-embedded.md), [ADR-016](./adr-016-runner-platform.md)

## Контекст

Топология deployment (какие pipeline на каком worker-role, legacy vs runner-platform, obs sidecar) размазана по env-флагам и hardcode в composition root / dev-скриптах. Нет единого декларативного SSOT для cold-up, dev-stack и ODP badge.

## Решение

Корневой **`deployment.manifest.json`** + loader в `@radar/shared`:

| Секция | Назначение |
|--------|------------|
| `runners.pipelines[]` | pipelineKey, label, host, spawn, schedulingImpl, enabled |
| `infra.obs` | dockerize sidecar, mode |
| `transport` | зарезервировано (defaults пустые) |

### Overlay (приоритет снизу вверх)

1. `DEFAULT_DEPLOYMENT_MANIFEST` (TS)
2. `deployment.manifest.json`
3. `deployment.local.json` (gitignored локальные overrides)
4. `DEPLOY_*` env + legacy `*_RUNNER_PLATFORM_ENABLED`

### Env keys

```bash
DEPLOY_OBS_DOCKERIZE=1          # → DOCKERIZE_OBS (если не задан)
DEPLOY_OBS_DOCKERIZE_ALL=1      # → DOCKERIZE_ALL
DEPLOY_OBS_MODE=service         # → RADAR_OBS_MODE
DEPLOY_PIPELINE_TRACKING_SCHEDULING=runner-platform
DEPLOY_PIPELINE_PARSE_HOST=phase
```

### Consumers

- `odpResolve()` — читает pipelines + host/spawn/schedulingImpl для admin badge
- `dev-stack.mjs` / `cold-up.mjs` / `radar stack` — `applyDeploymentInfraEnv()` → DOCKERIZE_OBS/ALL
- Iter 5: `RuntimeResolver` + `PipelineLauncherFactory` — старт runners по host match

## Вне scope Iter 4

- Docker spawn per pipeline (`spawn: docker`) — только schema, без оркестратора
- DB-persisted deployment profile (см. ADR-014 v2)

## Последующие итерации

| Iter | Добавляет |
|------|-----------|
| 5 | RuntimeResolver, PipelineLauncherFactory, jobKernel pause/stop obs |
| 6 | Admin read API / Discovery UI |
