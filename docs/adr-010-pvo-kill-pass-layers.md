# ADR-010: Анализ эффективности ПВО (слои Kill / Pass)

Дата: 2026-06-12  
Статус: **Предложено**

Связано: [ADR-007](./adr-007-trajectory-graph-kalman-worker.md), [roadmap](./roadmap-tracking-forecasting.md)

---

## Контекст

Operational карта показывает факты и ленту `pvo_report`, но не отвечает на вопрос: **где ПВО реально останавливает цели, а где пропускает?** Бумажный радиус поражения комплекса часто не совпадает с OSINT-наблюдениями.

**Принципы:** Kill Chain Analysis, Spatio-Temporal Interference.

**Value:** очень высокая — чистая военная аналитика, коридоры прорыва.

---

## Решение

### Три read-side слоя

| Слой | ID | Содержание |
|------|-----|------------|
| Тепловая карта ПВО | `pvo_heatmap` | Плотность `pvo_report` / air_defense событий |
| Kill | `kill` | Terminal nodes треков в зоне ПВО (подтверждённые сбития) |
| Pass | `pass` | Сегменты треков, прошедшие зону ПВО и продолжившие движение |

### Классификация сегментов

Вход:

- `trajectory_tracks` + `trajectory_nodes` ([ADR-007](./adr-007-trajectory-graph-kalman-worker.md))
- Зоны ПВО: buffer вокруг `pvo_report` точек + опционально полигоны покрытия (v2)

Правила v1:

1. **Kill:** последний kinematic node трека (`correct`) попадает в зону ПВО и трек `closed` без выхода из зоны в течение `KILL_CONFIRM_WINDOW` (default 30 min).
2. **Pass:** существует сегмент `[node_i → node_{i+1}]`, где `node_i` внутри зоны, `node_{i+1}` снаружи, и трек продолжается ≥ 2 nodes после выхода.
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

### pvo_heatmap

Расширение существующего heatmap-паттерна ([event-heatmap.ts](../packages/shared/src/schemas/map/event-heatmap.ts)):

- Фильтр: `event_type IN ('pvo_report', ...)` или `eventCategory` + dictionary
- Отдельный endpoint или `layer=pvo_heatmap` на unified layers API

### Вычисление

- Batch job в tracking worker (после rebuild треков) или on-read с кешем.
- v1: **materialized** `trajectory_segments` table (опционально) для производительности.

---

## Зависимости

- ADR-007 — готовые треки
- Существующий `GET /map/pvo-reports` — источник фактов, не дублировать write-path

---

## Не делаем

- Оценку типа БПЛА / ракеты на первом этапе
- 3D зоны ПВО — только 2D buffer v1

---

## Последствия

| Плюс | Минус |
|------|-------|
| Реальная, а не бумажная картина ПВО | Качество зависит от полноты pvo_report |
| Автоматические коридоры прорыва | False kill при грубой геолокации |

---

## Критерии принятия

- API отдаёт три слоя, валидируемые Zod
- Golden fixture: трек через зону ПВО → segment `pass`
- Golden fixture: трек обрывается в зоне → node `kill`
