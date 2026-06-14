# Документация Radar

## С чего начать

| Документ | Когда читать |
|----------|----------------|
| **[cheatsheet.md](./cheatsheet.md)** | **Шпаргалка:** ingest, backfill CLI, SQL, UI, диагностика |
| **[runbook/geo-clean-rebuild.md](./runbook/geo-clean-rebuild.md)** | **Сброс БД → geo:catalog:import → backfill → reparse/rebuild** |
| **[shpargalka-operacii.md](./shpargalka-operacii.md)** | **Wipe/reset/clear**, geo-каталог, REST API, сценарии |
| **[getting-started.md](./getting-started.md)** | **Запуск всего продукта локально** (API, web, worker, БД, ingest) |
| [architecture-layers-and-wiring.md](./architecture-layers-and-wiring.md) | Полная схема слоёв, DIP/wiring и форматы данных |
| [plan.md](./plan.md) | Продуктовое видение и roadmap |
| [rfc/master-implementation-roadmap.md](./rfc/master-implementation-roadmap.md) | **Parse + ODP + Tracking — единая карта шагов** |
| [sdd/README.md](./sdd/README.md) | **SDD — пошаговые спецификации реализации (Tracking, ODP, Parse)** |
| [roadmap-tracking-forecasting.md](./roadmap-tracking-forecasting.md) | **Трекинг и прогнозирование** (Kalman, Kill/Pass, эллипсы) |
| [ingest-providers.md](./ingest-providers.md) | Telegram ingest: session, manifest, CLI |
| [backfill-v2-pipeline.md](./backfill-v2-pipeline.md) | Автодокачка истории (демон + API) |
| [domain/README.md](./domain/README.md) | Доменная модель, события, потоки данных |

## SDD (реализация по фазам)

| Поток | Индекс | План / база |
|-------|--------|-------------|
| **Все потоки** | [sdd/README.md](./sdd/README.md) | [master-implementation-roadmap.md](./rfc/master-implementation-roadmap.md) |
| Tracking | [sdd/tracking/](./sdd/tracking/README.md) | [sdd/tracking/plan.md](./sdd/tracking/plan.md) |
| ODP | [sdd/odp/](./sdd/odp/README.md) | [adr-014](./adr-014-operational-domain-profile.md) |
| Parse | [sdd/parse/](./sdd/parse/README.md) | [parse-processor-workspace.md](./rfc/parse-processor-workspace.md) |

---

## По темам

| Тема | Файлы |
|------|--------|
| Ingest / Telegram | [ingest-providers.md](./ingest-providers.md), [domain/contexts/ingest.md](./domain/contexts/ingest.md), [backfill-v2-pipeline.md](./backfill-v2-pipeline.md) |
| Слои и wiring | [architecture-layers-and-wiring.md](./architecture-layers-and-wiring.md) |
| Потоки в коде | [domain/how-it-works.md](./domain/how-it-works.md) |
| Parse / domain pack | [master-implementation-roadmap.md](./rfc/master-implementation-roadmap.md), [parse-processor-workspace.md](./rfc/parse-processor-workspace.md), [adr-014](./adr-014-operational-domain-profile.md), [operational-domain-profile-walkthrough.md](./rfc/operational-domain-profile-walkthrough.md), [data/domains/](../data/domains/README.md) |
| Geo-артефакты / каталог | [runbook/geo-clean-rebuild.md](./runbook/geo-clean-rebuild.md), [data/geo/README.md](../data/geo/README.md) |
| LLM / Ollama | [ollama-sampling-and-model-tuning.md](./ollama-sampling-and-model-tuning.md) |
| Доверие к местам | [place-trust-explained.md](./place-trust-explained.md), [adr-002-place-trust-provenance.md](./adr-002-place-trust-provenance.md) |
| Phase-pipeline v2 | [phase-pipeline.md](./phase-pipeline.md), [phase-pipeline-status.md](./phase-pipeline-status.md), [api/phases-admin.md](./api/phases-admin.md), [adr-003](./adr-003-phase-enrichment-accumulator.md) |
| Трекинг / прогноз | [master-implementation-roadmap.md](./rfc/master-implementation-roadmap.md), [roadmap-tracking-forecasting.md](./roadmap-tracking-forecasting.md), [tracking-pipeline-phases.md](./rfc/tracking-pipeline-phases.md), [adr-007](./adr-007-trajectory-graph-kalman-worker.md)..[013](./adr-013-trajectory-flow-and-path-fan.md), [features/](./features/) |
| Карта: слои, теплокарта, Time Machine | корневой [README § Сейчас в продукте](../README.md#сейчас-в-продукте), API `GET /map/events/heatmap`, `GET /map/snapshot?asOf=` |

Корневой [README.md](../README.md) — обзор продукта и полный список npm-скриптов.
