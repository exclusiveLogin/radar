# ADR-020: Унификация нейминга операционных таблиц пайплайна

**Статус:** accepted  
**Дата:** 2026-07-08  
**Связано:** [database-table-naming.md](../database-table-naming.md) (SSOT), миграция `1752800000000-UnifyPipelineTableNames`

## Контекст

В Postgres ~34 прикладных таблицы с четырьмя стилями имён. По имени таблицы нельзя сразу понять роль, фазу и сущность.

## Решение

Формула `{role}_{phase}_{entity}` для операционных таблиц. Полный маппинг и исключения — в [database-table-naming.md](../database-table-naming.md).

## Политика миграций

- Forward-only: `ALTER TABLE … RENAME TO …`
- Старые миграции не редактируем
- Compat VIEW не делаем
- Колонки не меняем

## Маппинг (21 RENAME)

| Было | Станет |
|------|--------|
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
