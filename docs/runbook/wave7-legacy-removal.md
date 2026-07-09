# Runbook — Wave 7 legacy removal

База: [ADR-016](../adr-016-runner-platform.md) · [prod-cutover.md](./prod-cutover.md) · [release-checklist.md](../sdd/runner-platform/release-checklist.md)

**Статус:** manifest migration complete ([ADR-021](../rfc/adr-021-manifest-env-ssot.md), f7028fd). Wave 7 **заблокирован** до prod cutover всех трёх доменов на `schedulingImpl=runner-platform`.

---

## Предусловия (hard gate)

- [ ] `schedulingImpl=runner-platform` для parse в prod ≥30 дней без rollback
- [ ] `schedulingImpl=runner-platform` для geo-enrich в prod ≥30 дней
- [ ] `schedulingImpl=runner-platform` для tracking в prod ≥30 дней
- [ ] Gate A–D pass задокументированы для каждого домена
- [ ] Нет активных инцидентов по cursor/duplicate materialize

---

## Что удаляем (после cutover)

| Legacy класс | Домен | Замена |
|--------------|-------|--------|
| `IngestParseDaemonService` | parse | `parseRunnerRegistry` + jobKernel |
| `PlaceEnrichmentDaemonService` | geo-enrich | `geoEnrichRunner` |
| `TrackingRebuildDaemon` | tracking | `trackingRunner` |
| Feature flags `*_RUNNER_PLATFORM_ENABLED` | all | **DONE** (ADR-021 f7028fd) → `deployment.manifest.json` `schedulingImpl` |
| Ветвление legacy/runner в `createWorkerCompositionRoot.ts` | all | Только runner platform path |

---

## Что **не** удаляем

- Чистые domain functions (`PhaseRunner`, `runIncrementalBatch`, Kalman math)
- Control tables (`state_track_pipeline`, `queue_parse_coverage`, `job_geo_place_enrich`)
- Admin API (enable/pause/reset/rebuild)
- `obs_*` observability tables

---

## План удаления (поэтапно)

### Фаза 1 — parse

1. Убедиться prod на `schedulingImpl=runner-platform` ≥30d
2. Удалить `IngestParseDaemonService` + imports
3. Smoke: ingest → parse → geo

### Фаза 2 — geo-enrich

1. Удалить `PlaceEnrichmentDaemonService`
2. Smoke: MessageParsed → geo jobs drain

### Фаза 3 — tracking

1. Удалить `TrackingRebuildDaemon`
2. Smoke: tracks rebuild + map API

### Фаза 4 — cleanup composition root

1. Упростить `createWorkerCompositionRoot.ts` — один path
2. `deployment.manifest.json` — default `schedulingImpl: runner-platform`
3. Обновить docs (legacy env flags уже удалены — ADR-021)

---

## Проверка после Wave 7

```powershell
npm run typecheck
npm run radar -- pipeline status
npm run radar -- dev ws-smoke
# E2E: docs/runbook/e2e-bus-chaining.md
```

---

## Rollback Wave 7

Wave 7 **необратима** без git revert. Перед каждой фазой — tag release:

```powershell
git tag pre-wave7-parse-$(Get-Date -Format yyyyMMdd)
```

При проблемах — revert commit, redeploy предыдущий tag.
