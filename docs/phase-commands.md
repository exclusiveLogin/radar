# Фазовые команды (wipe / reset / clear)

Пайплайн: **vendor → ingest → parse → geo** (+ structural **geo-catalog** в БД).

**Таблицы radar ↔ legacy:** единый справочник — [`radar-cli.md § phase / pipeline`](./radar-cli.md#phase--wipe--reset--clear).

---

## Семантика

| Действие | Смысл |
|----------|--------|
| **wipe** | Состояние «фаза раскатана, пользовательского контента нет» |
| **reset** | Снять только **обогащение** (координаты, trust, очереди geo), базовые строки остаются |
| **clear** | Только **очереди** (`phase_coverage`, `place_enrichment_jobs`, cancel `phase_runs`) |
| **run** | Раскатка фазы (без удаления) |

Мутирующие команды поддерживают **`--dry-run`** (или `--dry`).

---

## Заметки по фазам

### vendor (диск, не radar domain)

| Команда | Эффект |
|---------|--------|
| `vendor:run` | `geo:vendor` + `geo:sync` |
| `vendor:wipe` | Удалить `data/geo/vendor`; `artifacts` — только `--with-artifacts` |

### ingest

- `phase wipe ingest` — raw + parsed, evloc, cursors/backfill.
- **Не трогает:** places, regions, geo_feature.

### parse

- `phase wipe parse` — parsed + evloc; **raw остаётся**.
- Операционный reparse без wipe: `pipeline reset` → `parse run` (см. radar-cli).

### geo (places)

> ⚠️ `phase wipe geo` обнуляет `event_locations.place_id` перед удалением (FK RESTRICT). Строки evloc остаются.

### geo-catalog (structural БД)

Перед `phase wipe geo-catalog` обычно нужен `phase wipe geo` (пустые places).

---

## Что никогда не удаляется wipe-командами

`channels`, `ingest_providers`, `ingest_bindings`, `phase_definitions`, `.env`, Telegram session.
