> **Имена таблиц:** актуальные — [database-table-naming.md](./database-table-naming.md). Ниже — исторический контекст.

# ADR-007: Фоновая сборка графа траекторий (Kalman worker)

Дата: 2026-06-12  
Статус: **Предложено**

Связано: [ADR-008](./adr-008-kinematic-vs-static-events.md), [ADR-009](./adr-009-osint-pre-collapse.md), [roadmap](./roadmap-tracking-forecasting.md)

---

## Контекст

OSINT-поток даёт до ~150k геоточек без стабильных object ID (бортовых номеров). Точки приходят из разных Telegram-каналов с разным lag и точностью. Operational fold ([ADR-006](./adr-006-map-read-line-fold.md)) отвечает на вопрос «какой статус региона сейчас», но не строит непрерывные траектории движущихся целей.

Проблемы без tracking-домена:

- Ручная разметка «это одна и та же цель» не масштабируется.
- Скорость и курс нельзя вычислить из одиночных точек без модели движения.
- Прогноз «где цель сейчас» невозможен при паузе в наблюдениях.

---

## Решение

### Background worker в `packages/worker`

Фоновый job (не на write-line parse) выполняет пайплайн:

```text
load mat_parse_location (window)
  в†’ pre-collapse (ADR-009)
  в†’ kinematic/static routing (ADR-008)
  → spatio-temporal linking (предок → потомок)
  в†’ Kalman correct/predict per track
  в†’ persist trajectory_*
```

**Принципы:**

- **Spatio-Temporal Clustering** — связь точек по близости в пространстве и времени.
- **Kalman Filtering** — состояние `[x, y, vx, vy]`; матрица шума процесса Q масштабируется от `dt³`, `dt⁴`.
- **Directed graph** — узлы (`mat_track_node`) и рёбра parent→child внутри трека.

### Хранение (предложение)

```sql
mat_track (
  id              uuid PK,
  status          text,       -- active | closed | stale
  first_at        timestamptz,
  last_at         timestamptz,
  last_lat        numeric,
  last_lon        numeric,
  velocity_ms     numeric,    -- |v| из Kalman
  bearing_deg     numeric,
  node_count      int,
  created_at      timestamptz,
  updated_at      timestamptz
)

mat_track_node (
  id              uuid PK,
  track_id        uuid FK в†’ mat_track,
  seq             int,        -- порядок в треке
  occurred_at     timestamptz,
  lat             numeric,
  lon             numeric,
  mode            text,       -- correct | attach_only (ADR-008)
  event_location_id uuid FK,  -- nullable для synthetic nodes
  kalman_state    jsonb,     -- { x, y, vx, vy, P: number[4][4] }
  source_refs     jsonb,      -- [{ rawMessageId, parsedEventId, text }]
  created_at      timestamptz
)
```

Рндексы: `(track_id, seq)`, `(occurred_at)`, `(event_location_id)` unique where not null.

### SSOT логики

`packages/shared/src/domain/tracking/` — pure functions:

- `linkNodes(candidates)` — spatio-temporal graph
- `kalmanStep(state, observation, dt)` — обёртка над `kalman-filter`
- `buildTrack(nodes)` — агрегация метаданных трека

Worker — оркестратор; API — read adapter.

### API (read-side)

| Endpoint | Назначение |
|----------|------------|
| `GET /map/tracks` | Список треков за период / bbox / `asOf` |
| `GET /map/tracks/:id` | Полный трек с nodes и Kalman snapshot |

Query: `since`, `until`, `asOf`, `bbox`, `status`, `limit`.

### Zod-скелеты контрактов (описание, реализация — фаза 1)

```typescript
/** Слой сегмента трека для Kill/Pass (ADR-010). */
type TrackLayer = "body" | "kill" | "pass";

type TrajectoryNode = {
  id: string;
  seq: number;
  occurredAt: string; // ISO8601
  lat: number;
  lon: number;
  mode: "correct" | "attach_only";
  sourceRefs: Array<{ rawMessageId?: string; parsedEventId?: string; text?: string }>;
};

type TrajectoryTrack = {
  id: string;
  status: "active" | "closed" | "stale";
  firstAt: string;
  lastAt: string;
  velocityMs: number | null;
  bearingDeg: number | null;
  nodes: TrajectoryNode[];
  /** Заполняется ADR-010. */
  segments?: Array<{ layer: TrackLayer; fromSeq: number; toSeq: number }>;
};
```

---

## Не делаем

- Realtime Kalman на write-line parse — только batch/инкрементальный worker.
- Рзменение operational fold или `mat_parse_event` schema на первом этапе.
- Жёсткая привязка к бортовому номеру — трек = emergent cluster.

---

## Последствия

| Плюс | Минус |
|------|-------|
| Автоматизация без object ID | Новые таблицы + worker job |
| Основа для прогноза и Kill/Pass | Нужен checkpoint/rebuild при смене алгоритма |
| Чистое разделение от fold | Латентность: треки отстают от live ingest |

---

## Критерии принятия

- Worker пересобирает треки из `mat_parse_location` идемпотентно (re-run safe).
- API отдаёт `TrajectoryTrack` валидируемый Zod.
- Unit-тесты на link + Kalman step в `@radar/shared`.

