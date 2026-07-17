> **Имена таблиц:** актуальные — [database-table-naming.md](./database-table-naming.md). Ниже — исторический контекст.

# ADR-010: Kill / Pass — эффективность перехвата (read-side слои)

Дата: 2026-06-12  
Статус: **Предложено**

Связано: [ADR-007](./adr-007-trajectory-graph-kalman-worker.md), [roadmap](./roadmap-tracking-forecasting.md), [ADR-014 § D6](./adr-014-operational-domain-profile.md#api-read-side-decoupling-фаза-d6)

---

## Контекст

Operational карта показывает факты и ленту macro-отчётов (`pvo_report`), но не отвечает на вопрос: **где перехват реально останавливает цели, а где пропускает?** Бумажный радиус поражения комплекса часто не совпадает с OSINT-наблюдениями.

**Принципы:** Kill Chain Analysis, Spatio-Temporal Interference.

**Value:** очень высокая — чистая военная аналитика, коридоры прорыва.

---

## Решение

### Три read-side слоя

| Слой | ID | Содержание |
|------|-----|------------|
| Report density heatmap | `pvo_heatmap` | Плотность `pvo_report` / air_defense событий (→ D6: generic filter) |
| Kill | `kill` | Terminal nodes треков в зоне перехвата (подтверждённые сбития) |
| Pass | `pass` | Сегменты треков, прошедшие зону и продолжившие движение |

### Классификация сегментов

Вход:

- `mat_track` + `mat_track_node` ([ADR-007](./adr-007-trajectory-graph-kalman-worker.md))
- Зоны перехвата: buffer вокруг report-точек + опционально полигоны покрытия (v2)

Правила v1:

1. **Kill:** последний kinematic node трека (`correct`) попадает в зону и трек `closed` без выхода из зоны в течение `KILL_CONFIRM_WINDOW` (default 30 min).
2. **Pass:** существует сегмент `[node_i → node_{i+1}]`, где `node_i` внутри зоны, `node_{i+1}` снаружи, и трек продолжается ≥ 2 nodes после выхода.
3. **Body:** остальные сегменты трека.

```typescript
type TrackLayer = "body" | "kill" | "pass";

type TrackSegment = {
  trackId: string;
  layer: TrackLayer;
  fromSeq: number;
  toSeq: number;
  coordinates: Array<[lon, lat]>;
};
```

### API контракт

| Endpoint | Ответ |
|----------|-------|
| `GET /map/tracks/layers?layer=kill\|pass\|pvo_heatmap` | GeoJSON FeatureCollection |
| `GET /map/tracks/:id` | `segments[]` с `layer` (embedded) |

Query: `since`, `until`, `asOf`, `bbox`, `limit`.

### GeoJSON properties (kill/pass segment)

```typescript
{
  trackId: string;
  layer: "kill" | "pass" | "body";
  fromSeq: number;
  toSeq: number;
  velocityMs: number | null;
  lastAt: string;
}
```

### Report density heatmap

Расширение существующего heatmap-паттерна ([event-heatmap.ts](../packages/shared/src/schemas/map/event-heatmap.ts)):

- Фильтр: через `status_dictionary.feed_kind` / `eventCategory` (не hardcode в SQL — ADR-014 D6)
- Отдельный endpoint или `layer=pvo_heatmap` на unified layers API

### Вычисление

- Batch job в tracking worker (после rebuild треков) или on-read с кешем.
- v1: **materialized** `trajectory_segments` table (опционально) для производительности.

---

## Зависимости

- ADR-007 — готовые треки
- Macro feed (`GET /map/event-feed` после D6) — источник фактов, не дублировать write-path

---

## Не делаем

- Оценку типа цели на первом этапе
- 3D зоны — только 2D buffer v1

---

## Последствия

| Плюс | Минус |
|------|-------|
| Реальная, а не бумажная картина перехвата | Качество зависит от полноты macro-отчётов |
| Автоматические коридоры прорыва | False kill при грубой геолокации |

---

## Критерии принятия

- API отдаёт три слоя, валидируемые Zod
- Golden fixture: трек через зону в†’ segment `pass`
- Golden fixture: трек обрывается в зоне в†’ node `kill`

