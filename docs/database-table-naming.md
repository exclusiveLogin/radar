# Database table naming (SSOT)

Единая схема имён операционных таблиц пайплайна. ADR: [adr-020-database-table-naming.md](./rfc/adr-020-database-table-naming.md).

## Формула

```
{role}_{phase}_{entity}  — операционные (singular entity)
{plural_noun}            — structural catalog
obs_{entity}              — observability BC
```

## Роли

| role | Смысл | Пример |
|------|-------|--------|
| mat_ | Materialized fact | mat_ingest_raw |
| queue_ | Row queue | queue_parse_coverage |
| job_ | Batch job | job_ingest_backfill |
| work_ | Workspace | work_parse_message |
| state_ | Cursor/watermark | state_ingest_cursor |
| event_ | Outbox transport | event_outbox |
| log_ | Append journal | log_parse_attempt |
| obs_ | Observability | obs_hosts |
| (none) | Structural | regions, channels |

## Observability tables (obs_*)

| Таблица | PK | Ключевые поля |
|---------|-----|---------------|
| obs_hosts | host_id | role, started_at, last_seen_at, odp_runtime jsonb, metrics jsonb |
| obs_executors | executor_id | host_id, kind, parent_id, last_seen_at, status, metrics jsonb |
| obs_workloads | workload_id | host_id, pipeline_key, runtime, status, last_tick_at, metrics jsonb |
| obs_trigger_counters | (pipeline_key, event_type, source) | count bigint |
| obs_materialize_counters | pipeline_key | count bigint, updated_at |

Миграция: `1752900000000-ObsTables`. ADR: [adr-017-observability-embedded.md](./rfc/adr-017-observability-embedded.md).

## Parse queue под runner platform

Runner platform использует **одну** queue-таблицу: `queue_parse_coverage` (`role=queue_`, `phase=parse`).

- **Claim** — `parseRunner` переводит строки `pending → processing` через `FOR UPDATE SKIP LOCKED` по `(raw_message_id, phase_id)`.
- **Нет `queue_parse_enrichment`** — отдельной enrichment-очереди в runner-архитектуре не существует.
- **Lineage имён** — `enrichment_queue` → `phase_coverage` → `queue_parse_coverage`: одна физическая таблица, смена имён. Не связано с выбором runner vs legacy daemon.
- **Миграция 1752800000000** — пропуск RENAME `enrichment_queue` лишь исторический факт БД (таблица уже смержена в `phase_coverage` до Epic G), не архитектурный слой.
- **Geo enrich** — `job_geo_place_enrich` (`job_`, не `queue_`).

## Навигатор: вопрос → таблица

| Вопрос | Таблица |
|--------|---------|
| Сырой текст до parse? | mat_ingest_raw (+ mat_ingest_raw_tg) |
| Курсор ingest? | state_ingest_cursor |
| Задача backfill? | job_ingest_backfill |
| Черновик parse? | work_parse_message |
| Разобранное событие? | mat_parse_event |
| Локация на карте? | mat_parse_location |
| Очередь фаз parse / enricher? | queue_parse_coverage |
| Geo enrich job? | job_geo_place_enrich |
| Трек? | mat_track + mat_track_node |
| Watermark tracking? | state_track_pipeline |
| Dedup tracking? | state_track_consumed |
| Outbox? | event_outbox |
| Канал/регион/place? | channels, regions, places |

## Маппинг old → new

| Было | Стало |
|------|-------|
| raw_messages | mat_ingest_raw |
| raw_message_telegram | mat_ingest_raw_tg |
| ingest_cursors | state_ingest_cursor |
| ingest_backfill_jobs | job_ingest_backfill |
| message_parse_workspace | work_parse_message |
| parsed_events | mat_parse_event |
| parse_attempts | log_parse_attempt |
| event_locations | mat_parse_location |
| event_evidence | mat_parse_evidence |
| enrichment_queue → phase_coverage | queue_parse_coverage |
| phase_runs | log_parse_phase_run |
| place_enrichment_jobs | job_geo_place_enrich |
| geo_sync_log | log_geo_sync |
| trajectory_tracks | mat_track |
| trajectory_nodes | mat_track_node |
| trajectory_rebuild_runs | job_track_rebuild |
| tracking_pipeline_state | state_track_pipeline |
| tracking_tune_runs | job_track_tune |
| tracking_pipeline_consumed | state_track_consumed |
| domain_events | event_outbox |
| event_subscriptions | state_event_subscription |

## Structural (без изменений)

channels, regions, places, place_aliases, place_geo_link, region_adjacency, geo_feature, geo_dataset_file, status_dictionary, ingest_providers, ingest_bindings, phase_definitions

## SQL-рецепты

```sql
-- Claim parse queue
SELECT id FROM queue_parse_coverage WHERE status = 'pending' FOR UPDATE SKIP LOCKED LIMIT 32;

-- Raw ingest
INSERT INTO mat_ingest_raw (channel_id, hash, raw_text) ON CONFLICT (hash) DO NOTHING;

-- Tracking watermark
SELECT watermark FROM state_track_pipeline WHERE id = 'default';
```

## Wipe order (FK)

state_track_consumed → mat_track_node → mat_track → job_track_rebuild → state_track_pipeline → mat_parse_location → mat_parse_event → work_parse_message → log_parse_attempt → queue_parse_coverage → mat_ingest_raw

## Поток данных

mat_ingest_raw → work_parse_message → mat_parse_event → mat_parse_location → (geo) job_geo_place_enrich → mat_track
