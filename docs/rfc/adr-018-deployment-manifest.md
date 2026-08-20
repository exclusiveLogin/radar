# ADR-018: Deployment manifest (Iter 4)

**Статус:** accepted  
**Дата:** 2026-07-09  
**Связано:** [ADR-017](./adr-017-observability-embedded.md), [ADR-016](./adr-016-runner-platform.md), [ADR-021](./adr-021-manifest-env-ssot.md)

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
4. `DEPLOY__nested__path=value` env (см. [ADR-021](./adr-021-manifest-env-ssot.md))

### Env keys (ADR-021)

```bash
DEPLOY__infra__obs__dockerize=true
DEPLOY__infra__obs__mode=service
DEPLOY__infra__obs__readMode=embedded
DEPLOY__runners__pipelines__parse__schedulingImpl=runner-platform
DEPLOY__runners__pipelines__tracking__host=tracking
DEPLOY__process__role=phase
```

> **Удалено:** `DEPLOY_OBS_*`, `DEPLOY_PIPELINE_*`, `applyDeploymentInfraEnv`, `DOCKERIZE_OBS` как каналы решения.

### Consumers

- `resolveObsConfig(manifest.infra.obs)` — obs write/read (ADR-021)
- `dev-stack.mjs` / `cold-up.mjs` / `radar stack` — `manifest.infra.obs.dockerize` для sidecar
- Iter 5: `RuntimeResolver` + `PipelineLauncherFactory` — старт runners по host match

## Вне scope Iter 4

- Docker spawn per pipeline (`spawn: docker`) — только schema, без оркестратора
- DB-persisted deployment profile (см. ADR-014 v2)

## Последующие итерации

| Iter | Добавляет |
|------|-----------|
| 5 | RuntimeResolver, PipelineLauncherFactory, jobKernel pause/stop obs |
| 6 | Admin read API / Discovery UI |
