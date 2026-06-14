# ADR-009: Предварительное OSINT-схлопывание (Data Fusion)

Дата: 2026-06-12  
Статус: **Предложено**

Связано: [ADR-003](./adr-003-phase-enrichment-accumulator.md), [ADR-007](./adr-007-trajectory-graph-kalman-worker.md)

---

## Контекст

Один физический инцидент часто порождает несколько сообщений из разных Telegram-каналов с разницей в 1–5 минут: «Сызрань — перехват» и «БПЛА над Монгорой». Без дедупликации Kalman получает кластер близких точек с разным timestamp → завышенная скорость и прогноз «в космос».

**Value:** средняя по отдельности, **критична для MVP** tracking pipeline.

**Принципы:** Data Fusion, Hierarchical Data Deduplication.

---

## Решение

### Позиция в пайплайне

```text
load event_locations (facts)
  → **pre-collapse**  ← этот ADR
  → kinematic routing (ADR-008)
  → spatio-temporal link (ADR-007)
  → Kalman
```

Схлопывание выполняется **до** Kalman и **после** загрузки facts из БД.

### Алгоритм (v1)

1. Сортировка кандидатов по `occurred_at`.
2. Скользящее окно **10 минут** — группа кандидатов для merge.
3. Внутри окна: кластеризация по proximity (haversine < `COLLAPSE_RADIUS_M`, default 15 km — tunable).
4. **Иерархия точности** — победитель определяет координаты схлопнутой ноды:
   - `accuracyLevel` = f(trust, precision) из накопителя [ADR-003](./adr-003-phase-enrichment-accumulator.md)
   - точное сообщение поглощает размытое; тексты всех источников сохраняются в `source_refs[]`
5. Выход — одна **kinematic node** на кластер (или attach_only node, если все статические).

### Поля схлопнутой ноды

```typescript
type CollapsedNode = {
  occurredAt: string;       // max(occurred_at) кластера или median — зафиксировать в impl
  lat: number;
  lon: number;
  accuracyLevel: number;      // 0..1
  sourceRefs: Array<{
    eventLocationId: string;
    parsedEventId: string;
    rawMessageId?: string;
    text?: string;
    channelId?: string;
  }>;
};
```

### Параметры (env / config)

| Параметр | Default | Описание |
|----------|---------|----------|
| `TRACKING_COLLAPSE_WINDOW_MS` | 600_000 (10 min) | Ширина окна |
| `TRACKING_COLLAPSE_RADIUS_M` | 15_000 | Радиус кластера |
| `TRACKING_MIN_ACCURACY_DELTA` | 0.15 | Минимальный разрыв для override координат |

### SSOT

`packages/shared/src/domain/tracking/collapseOsintNodes.ts` — pure function, без I/O.

---

## Не делаем

- Схлопывание на ingest/write-line — только в tracking worker.
- Удаление исходных `event_locations` — facts остаются append-only.
- Semantic dedup по тексту (отдельный backlog ingest).

---

## Последствия

| Плюс | Минус |
|------|-------|
| Защита Kalman от дубликатов каналов | Параметры окна/радиуса требуют тюнинга |
| Сохранение provenance в `source_refs` | Два близких разных объекта могут слиться (false positive) |

---

## Критерии принятия

- Golden fixture: 3 канала, 1 инцидент → 1 collapsed node, 3 source_refs.
- Golden fixture: дубликаты с разным accuracy → координаты от точного источника.
- Скорость трека после collapse в разумных пределах на тестовом датасете.
