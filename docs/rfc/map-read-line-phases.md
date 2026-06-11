# Map read-line: фазы миграции (ToBe)

См. [ADR-006](../adr-006-map-read-line-fold.md).

## Фаза 1 — Fold engine + shadow (DONE)

**Цель:** read-line считает `snapshot(asOf)` из facts; live остаётся на read_model.

- `MapStateFold` в `@radar/shared`
- `GET /map/snapshot?asOf=`
- `npm run map:fold:diff` — shadow vs read_model
- `mapApi.snapshot({ asOf })`

**Не делаем:** cutover live, удаление проекции, UI таймлайн.

---

## Фаза 2 — Cutover live на fold

**Критерий входа:** `map:fold:diff` → 0 mismatches (или согласованный allowlist).

- `getSnapshot()` без `asOf` → `getSnapshotAt(now)`
- WS pollers / `districts-active-geojson` на fold
- Feature flag `RADAR_MAP_READ_SOURCE=fold|read_model`
- Догнать fold: mass clear из текста, channel clear parity

**Коммит:** отдельный, только cutover + flag.

---

## Фаза 3 — Убрать write-side state

- Отписать `LastWinnerReadModelProjection` от `MessageParsed`
- Остановить `MapStateExpirySweep` / daemon
- Миграция: drop `*_status_read_model` (или VIEW)
- Обновить wipe/phase lifecycle docs

**Коммит:** отдельный, после стабильного cutover в проде.

---

## Фаза 4 — SOLID / чистая архитектура (без переходных костылей)

**Цель:** код соответствует ToBe, без дублирования SQL и shadow-хаков.

| Задача | Действие |
|--------|----------|
| Дубли SQL facts | Один `MapFactsLoader` (shared или api port), worker CLI через него |
| Fold + enrich | `MapSnapshotQuery` use-case; API — тонкий adapter |
| Именование | `parsed_events.parsed_at` → документировать/мигрировать на `posted_at` |
| Read-model следы | Удалить `sqlPlaceNotSuppressedByRegionClear` на таблицах, pure fold |
| Таймлайн UI | Store `historicalAsOf`, без смешения с live WS |
| Тесты | Golden fold fixtures из prod mismatches |

**Коммит(ы):** рефакторинг пакетами (shared → api → worker → web), без смешения с фичами.

---

## Вне фаз (параллельно)

- Raw semantic dedup (ingest)
- RVK parser gaps
- Heap/map leak fixes (web)

Каждая — свой коммит, не в фазах read-line.
