# Документация Radar

## С чего начать

| Документ | Когда читать |
|----------|----------------|
| **[radar-cli.md](./radar-cli.md)** | **SSOT CLI:** частые команды + таблицы radar ↔ legacy по доменам |
| **[cheatsheet.md](./cheatsheet.md)** | Ingest, backfill, SQL, UI, диагностика (без дубля таблиц) |
| **[runbook/geo-clean-rebuild.md](./runbook/geo-clean-rebuild.md)** | Сброс БД → catalog → backfill → reparse |
| **[shpargalka-operacii.md](./shpargalka-operacii.md)** | REST API, env, сценарии |
| **[phase-commands.md](./phase-commands.md)** | Семантика wipe/reset/clear |
| **[getting-started.md](./getting-started.md)** | Запуск всего продукта локально |
| [architecture-layers-and-wiring.md](./architecture-layers-and-wiring.md) | Полная схема слоёв, DIP/wiring |
| [plan.md](./plan.md) | Продуктовое видение и roadmap |
| [rfc/master-implementation-roadmap.md](./rfc/master-implementation-roadmap.md) | Parse + ODP + Tracking — единая карта |
| [sdd/README.md](./sdd/README.md) | SDD — пошаговые спецификации |
| [ingest-providers.md](./ingest-providers.md) | Telegram ingest |
| [backfill-v2-pipeline.md](./backfill-v2-pipeline.md) | Автодокачка истории |
| [domain/README.md](./domain/README.md) | Доменная модель |

### Частые команды (корень репо)

```powershell
npm run radar -- stack dev --full
npm run radar -- stack migrate
npm run radar -- geo catalog:import
npm run radar -- ingest backfill -- --all-bindings --batch-size=100
npm run radar -- parse run
npm run radar -- pipeline status
```

Полный справочник: [radar-cli.md](./radar-cli.md).

---

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
| CLI / операции | [radar-cli.md](./radar-cli.md), [cheatsheet.md](./cheatsheet.md), [phase-commands.md](./phase-commands.md) |
| Слои и wiring | [architecture-layers-and-wiring.md](./architecture-layers-and-wiring.md) |
| Потоки в коде | [domain/how-it-works.md](./domain/how-it-works.md) |
| Parse / domain pack | [master-implementation-roadmap.md](./rfc/master-implementation-roadmap.md), [adr-014](./adr-014-operational-domain-profile.md) |
| Geo-артефакты / каталог | [runbook/geo-clean-rebuild.md](./runbook/geo-clean-rebuild.md), [data/geo/README.md](../data/geo/README.md) |
| Phase-pipeline v2 | [phase-pipeline.md](./phase-pipeline.md), [api/phases-admin.md](./api/phases-admin.md) |
| Карта | корневой [README § Сейчас в продукте](../README.md#сейчас-в-продукте) |

Корневой [README.md](../README.md) — обзор продукта.
