# Feature: фильтрация тепловой карты по типу событий

Идея **#7** из [roadmap](../roadmap-tracking-forecasting.md).  
Фаза: **1** ([tracking-pipeline-phases](../rfc/tracking-pipeline-phases.md)).

---

## Цель

Быстрая фильтрация массива точек на read-side по типу события для классической тепловой карты. Аналитик в один клик видит географию очагов ПВО, взрывов или movement — без шума остальных типов.

**Принципы:** Declarative Layer Filtering, Density Aggregation.

**Value:** базовая / фундаментальная — точка входа для макро-среза.

---

## Текущее состояние

- Endpoint: `GET /map/events/heatmap` ([map.controller.ts](../../packages/api/src/map/map.controller.ts))
- Schema: [event-heatmap.ts](../../packages/shared/src/schemas/map/event-heatmap.ts)
- UI: `MapHeatmapControls` — только пресет периода (`24h|7d|30d|all`)
- **Нет** фильтра по `event_type` / `eventCategory`

> **Примечание:** `data/geo/dictionaries/layout.json` — тайл-грид субъектов РФ для SchematicMapWidget, **не** словарь типов событий. Источник фильтров — `status_dictionary` и `GET /map/status-dictionary`.

---

## API (расширение)

### Новые query parameters

| Param | Тип | Описание |
|-------|-----|----------|
| `eventType` | string | Код из `status_dictionary.code` (e.g. `pvo_report`) |
| `eventCategory` | string | `extras.eventCategory` (threat, movement, impact, …) |
| `eventTypes` | string | CSV для multi-select (e.g. `pvo_report,explosion`) |

Приоритет: `eventTypes` > `eventType`; `eventCategory` комбинируется AND.

### Пример

```http
GET /api/map/events/heatmap?period=7d&eventType=pvo_report
GET /api/map/events/heatmap?period=24h&eventCategory=movement
```

### Schema (additive)

```typescript
// event-heatmap.ts — расширение meta
export const eventHeatmapMetaSchema = z.object({
  period: eventHeatmapPeriodSchema,
  since: z.string().datetime().nullable(),
  until: z.string().datetime(),
  count: z.number().int().nonnegative(),
  eventType: z.string().optional(),
  eventCategory: z.string().optional(),
  eventTypes: z.array(z.string()).optional(),
});
```

Backward compatible: без фильтров — текущее поведение (все raise-события).

---

## Backend

`MapQueryService.getEventsHeatmapGeoJson`:

```sql
-- псевдо
WHERE pe.event_type = :eventType          -- если задан
  AND pe.extras->>'eventCategory' = :cat  -- если задан
```

Индекс (опционально): `(event_type)` на `parsed_events`, GIN на `extras` — при perf issues.

---

## UI

### `MapHeatmapControls`

- Select «Тип события» — опции из `status_dictionary` (кэш при старте карты)
- Select «Категория» — threat | movement | impact | all_clear | other
- Кнопка «Сбросить фильтр»
- При смене фильтра — refetch heatmap layer

### `heatmapStore`

```typescript
heatmapEventType$: BehaviorSubject<string | null>
heatmapEventCategory$: BehaviorSubject<string | null>
```

Wire в `useGeoMapLifecycle` → `mapApi.eventsHeatmap({ period, eventType, ... })`.

---

## Definition of Done

- [ ] API принимает `eventType` / `eventCategory`, meta отражает активные фильтры
- [ ] UI: селект типа в панели heatmap
- [ ] Без фильтра — поведение идентично текущему
- [ ] Zod schema + Swagger обновлены
- [ ] `npm run typecheck` зелёный

---

## Связь с ADR-010

Фильтр `eventType=pvo_report` — тот же источник данных, что `pvo_heatmap` layer в [ADR-010](../adr-010-pvo-kill-pass-layers.md). На фазе 1 — через heatmap endpoint; на фазе 3 — unified layers API при необходимости.
