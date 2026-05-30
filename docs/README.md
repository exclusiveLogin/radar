# Документация Radar

## С чего начать

| Документ | Когда читать |
|----------|----------------|
| **[cheatsheet.md](./cheatsheet.md)** | **Шпаргалка:** ingest, backfill CLI, SQL, UI, диагностика |
| **[getting-started.md](./getting-started.md)** | **Запуск всего продукта локально** (API, web, worker, БД, ingest) |
| [architecture-layers-and-wiring.md](./architecture-layers-and-wiring.md) | Полная схема слоёв, DIP/wiring и форматы данных |
| [plan.md](./plan.md) | Продуктовое видение и roadmap |
| [ingest-providers.md](./ingest-providers.md) | Telegram ingest: session, manifest, CLI |
| [backfill-v2-pipeline.md](./backfill-v2-pipeline.md) | Автодокачка истории (демон + API) |
| [domain/README.md](./domain/README.md) | Доменная модель, события, потоки данных |

## По темам

| Тема | Файлы |
|------|--------|
| Ingest / Telegram | [ingest-providers.md](./ingest-providers.md), [domain/contexts/ingest.md](./domain/contexts/ingest.md), [backfill-v2-pipeline.md](./backfill-v2-pipeline.md) |
| Слои и wiring | [architecture-layers-and-wiring.md](./architecture-layers-and-wiring.md) |
| Потоки в коде | [domain/how-it-works.md](./domain/how-it-works.md) |
| Geo-артефакты | [data/geo/README.md](../data/geo/README.md) (в репо) |
| LLM / Ollama | [ollama-sampling-and-model-tuning.md](./ollama-sampling-and-model-tuning.md) |
| Доверие к местам | [place-trust-explained.md](./place-trust-explained.md) |

Корневой [README.md](../README.md) — обзор продукта и полный список npm-скриптов.
