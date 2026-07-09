# Лог проекта Radar

Журнал выполненных шагов. Новые записи добавляем **сверху** (после блока «Текущий статус»).

Связанные документы: [plan.md](./plan.md) · [README.md](../README.md) · [place-trust-explained.md](./place-trust-explained.md)

---

## Текущий статус (2026-05-24)

| Фаза | Состояние |
|------|-----------|
| Каркас монорепо, Docker, API/worker/web | ✅ готово |
| Geo-пайплайн (vendor → artifacts → seed → db:apply) | ✅ готово |
| Парсинг БПЛА + write-side pipeline (C01–C16) | ✅ готово |
| Runtime geo enrichers (cache → dadata → nominatim → llm) | ✅ готово |
| Trust/provenance в runtime (places + place_evidence) | ✅ итерация 1 |
| **Trust/provenance на read-side для UI** | 🔄 **итерация 2 — в работе** |
| Batch enrichment orchestration (Dadata/LLM) | ⏳ итерация 3 |
| Web UI (карта, time machine, алерты) | ⏳ не начато |

### Итерация 2 — чеклист

| # | Задача | Статус |
|---|--------|--------|
| 1 | Протянуть `TypeOrmPlaceEvidenceRepository` в read-side wiring | ❌ |
| 2 | Read-side: trust summary + evidence history | ❌ |
| 3 | `GET /api/places/:placeId/evidence?limit=...` | ❌ |
| 4 | `needsAttention` в place DTO/read model | ❌ |
| 5 | Swagger + docs sync | 🟡 частично (docs есть, API — нет) |
| 6 | Quality gates (`typecheck`, `lint`, smoke) | ❓ не прогоняли в рамках ит.2 |

**Следующий шаг:** wiring evidence repo в read-side → endpoint evidence history → trust-поля и `needsAttention` в выдаче places.

---

## Записи

### 2026-07-09 — Iter 7: observability docs + Epic C–H runbooks

**Сделано:**
- Iter 7: `docker-dev-stack.md` (DOCKERIZE_OBS/ALL), `runbook/observability.md`, `observability-daemon.md`, runner runbook (pause/badges), `.env.example` sync
- Quickstart нового разработчика в `getting-started.md`
- `how-it-works.md`: observability-flow + runner chaining
- Epic C: `runbook/staging-gates.md` (Gate A–D)
- Epic D: `runbook/e2e-bus-chaining.md`
- Epic E: `runbook/prod-cutover.md`
- Epic F: `runbook/wave7-legacy-removal.md`
- Epic H: `rfc/adr-019-tracking-ml-engine.md` (design only)

### 2026-07-08 — DB: унификация нейминга таблиц (Epic G)

**Сделано:**
- Forward-миграция: 22× RENAME (`raw_messages` → `mat_ingest_raw`, …)
- Код: entities, repos, shared/worker SQL
- SSOT: [database-table-naming.md](./database-table-naming.md), [ADR-020](./rfc/adr-020-database-table-naming.md)

**Маппинг (кратко):** см. таблицу old→new в database-table-naming.md

**Док:** persistence-map, cheatsheet, cold-start, … синхронизированы

**Gate:** migrate + wipe→ingest→parse→geo→track (ручной smoke)

### 2026-06-20 — Web: разделение лент «Сообщения» / «Лента изменений»

**Сделано:**
- Два endpoint + два store (`messagesStore`, `stateChangesFeedStore`); убран derived `messagesFeed$` из потока events.
- `GET /map/messages/recent`: 1 строка на raw, поля `contentKind`, `parsedEventCount`, `hasLocations`; бейджи шум/meta/raw/тип (fix: `cleared` без loc → green Badge, не «parse»).
- `GET /map/events/recent`: только loc (`mat_parse_location`), снят фильтр `state_level <> grey`.
- `classifyContentKind` перенесён в `@radar/shared` (API + worker re-export).

**Архитектура:** контракты лент разведены (raw ingest ≠ loc events); карта по-прежнему fold read-line. Mass-clear без EL — в «Сообщениях» и на карте (синтетика fold), не в loc-ленте.

**Док:** [web-map-feeds.md](./web-map-feeds.md) · коммиты `81f75c8` → `e18c8c8`.

### 2026-06-11 — Web geo-map: декомпозиция виджета, FetchPhase, per-layer fetch-status

**Сделано:**
- `GeoMapWidget` — только canvas (~20 строк); lifecycle в `useGeoMapLifecycle`, хелперы в `geoMapEngine`
- HUD-оверлеи вынесены в `AppShell`: `GeoMapOverlays` (stats + log), как `MapLayersPanel` / `MapTimelineBar`
- RxJS FetchPhase: `loading$/data$/error$` → `wireLayerFetchStreams` → per-layer `*FetchStatus$`
- SSOT: `geoMapLayerFetchStore` (regions/districts/heatmap), `geoMapStatsStore`, `geoMapLogStore`
- Удалены дубли: `geoMapLayerStatusStore`, `geoMapDistrictsStore`, `heatmapLoading$/heatmapError$`

**Оценка архитектуры:** 9/10 — согласованные слои, smart UI-оверлеи, нет prop drilling.

**Рекомендации по доработкам (geo-map / web):**

| Приоритет | Задача | Зачем |
|-----------|--------|-------|
| P1 | Разбить `useGeoMapLifecycle` на модули: `setupMapLayers`, `wireMapSubscriptions`, `wireMapHandlers` | Сейчас ~800 строк — единственный «толстый» узел |
| P1 | Unit-тесты: `geoMapRx` (splitFetchPhase), `geoMapEffects` (triggers/debounce), `geoMapPaint` (fingerprints) | Архитектура готова к тестам, покрытия нет |
| P2 | `geoMapStats$` → derived stream из lifecycle (или selector), если счётчики останутся единственным потребителем | Убрать ручной `setGeoMapStats` в apply-хуках |
| P2 | Единый registry виджетов карты в `widgetRegistry` для overlays (stats, log, layers, timeline) | Симметрия с background/left/right зонами |
| P3 | Smoke-сценарии карты: bootstrap → regions error badge → toggle heatmap → timeline scrub | Зафиксировать регрессии fetch-status + HUD |
| P3 | `places` fetch-status — только если появится отдельный HTTP для places (сейчас не нужен) | Не плодить слоты без реального fetch |

**Следующий шаг (вне geo-map):** итерация 2 trust/provenance на read-side (см. чеклист выше).

### 2026-05-25 — Ingest: ревью архитектуры, документация manifest v2

- Расширена документация [ingest-providers.md](./ingest-providers.md):
  - manifest v2: описание всех полей с примерами для каждого `bindingMode`
  - схема «provider → ЧЕМ, channel → ЧТО, binding → КАК»
  - примеры entry для DM, группы, hybrid, канала
  - описание поведения import (insert-only для provider/binding, upsert для channel)
- Зафиксированы архитектурные решения в [plan.md](./plan.md):
  - `ingestMode` (live/backfill/manual): сейчас влияет только на курсор, закладка на будущее
  - Холодный запуск: нет истории, только новые сообщения с момента старта
  - `rawPayload` (JSONB) — полный оригинал; O2O `mat_ingest_raw_tg` — индексная выжимка для dedup
- Backlog: gap recovery / frontfill (отдельный сервис с retry/backoff/checkpoint), auth admin API, auto-backfill, webhook/rss adapters

### 2026-05-14 — Raw Ingest Providers (итерация закрыта)

- `ingest_providers` + `ingest_bindings` + `mat_ingest_raw_tg` + session runtime store
- Telegram adapter (user/bot/hybrid), admin `POST /api/admin/ingest/messages`, timeline/backfill API
- Worker `RADAR_STORAGE_MODE=db`: OutboxRelay → parse по uuid
- Validation: `typecheck` ✓ (api/worker/shared), `lint` ✓
- Docs: [ingest-providers.md](./ingest-providers.md), README, `.env.example`

### 2026-05-12 — Trust/provenance: итерация 1 закрыта

- `feat(geo)`: trust/provenance tracking для places (`6f2012b`)
- `feat(geo)`: monotonic place contribution merge (`504b1bb`)
- `refactor`: shared utility для merge вместо дублирования в api/worker (`547bf38`, `930c3aa`)
- `docs`: README + geo-dataset-schemas + place-trust model (`01c01fc`)
- `chore(cursor)`: Context7 & lean-ctx MCP, project skills (`76ba214`)
- `refactor`: декларативные flows api/worker, комментарии domain/parsing (`bc7fd8e`, `57ab14d`)
- Roadmap обновлён в `docs/plan.md` — итерация 2 зафиксирована

### 2026-05-11 — Рефакторинг и отчёты парсера

- `refactor(worker-cli)`: упрощение storage mode flag resolution (`434ab3d`)
- README: ссылка на гайд sampling parameters; snap_004 без LLM-шума (`dc706be`)

### 2026-05-09 — LLM geocoder: стабилизация

- `fix(worker)`: LLM возвращает массив places, dedup в finalizer (`d2d6f7f`)
- `fix(worker)`: dedup places, catalog casing, city punctuation (`8e2463e`)
- `refactor(worker)`: LlmStep / LlmEnricher для geo extraction (`70428df`)
- `fix(worker)`: prompt noise filters, regionCode lookup (`c530048`)
- `fix(worker)`: русские регионы в косвенном падеже и после запятых (`a4aa9bf`)
- `docs`: llm model log (`c276825`)

### 2026-05-08 — Multi-region + LLM enricher

- `fix(worker-parser)`: Cyrillic matching, убран `\b` false negative (`9a41c8f`)
- `feat(worker)`: multi-region geo resolution (`d779187`, `0cf31ff`, `54c3452`)
- `feat(worker)`: Ollama-backed LLM enricher + local LLM stack (`ad43393`)
- `feat(worker)`: granular enricher toggles (env + parse:snap CLI) (`02a4ba4`)
- `feat(shared)`: `geoArtifact` в ParseReport для отладки pipeline (`a268dde`)
- `feat(worker)`: district name cleaning, fallback city extraction (`f1060ff`)
- `docs(tests)`: aggregated report command; удалён устаревший snap_002 (`a250543`, `13ba452`)

### 2026-05-07 — Geo sync + place status + read-side fix

- `fix(api)`: восстановлены read-side routes, barrel imports entities (`454e991`)
- `feat(geo)`: place status management, place_cache, validation metadata (`ac122db`)
- `feat(geo)`: normalization, key generation, semantic diff, source metadata (`5debcd2`)
- `feat(geo)`: `geo:init`, `geo:update` scripts, storage models docs (`0c6ce87`)

### 2026-05-05 — Полный pipeline + cold start

- `feat(radar)`: UAV parsing + DB linkage C01–C16 — shared contracts, events bus, geo providers/sync, worker parsing, write-side, admin-bot HLD (`f771091`)
- `feat(platform)`: Node cold-start scripts, geo snapshot pipeline, pgAdmin, product README (`b11caef`)
- `feat(dev)`: Docker radar network, pgAdmin, geo pipeline, `cold:up`, test snapshots (`e8b0a59`)

### 2026-05-04 — Старт репозитория

- `Initial commit` (`503d54b`)
- `chore`: scaffold TS monorepo — api/worker/web/shared, Docker Postgres, Nest+TypeORM+Swagger, Vite+React, GramJS, Zod, `docs/plan.md` (`4e0923f`)
- `chore`: worker build process, radar env vars, shared schemas (`057b272`)

---

## Шаблон новой записи

```markdown
### YYYY-MM-DD — Краткий заголовок

- что сделано (1–3 пункта)
- ссылка на commit / PR (если есть)
- блокеры или next step (если есть)
```
