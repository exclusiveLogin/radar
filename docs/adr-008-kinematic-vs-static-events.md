# ADR-008: Мультимодальная селекция событий (кинематика vs статика)

Дата: 2026-06-12  
Статус: **Предложено**

Связано: [ADR-007](./adr-007-trajectory-graph-kalman-worker.md), [ADR-009](./adr-009-osint-pre-collapse.md)

---

## Контекст

Не все геоточки описывают движение цели. События «работа перехвата», «взрыв», «падение обломков» фиксируют дискретное состояние в пространстве, но не должны корректировать вектор скорости летящего объекта. Если передать их в `kalman.correct()`, фильтр обнулит скорость и сломает прогноз.

**Принцип:** Separation of Kinematics and Event States — кинематические наблюдения меняют физическое состояние; статические — только привязываются к графу трека для отображения.

---

## Решение

### Два режима обработки узла

| Режим | Kalman | Назначение |
|-------|--------|------------|
| `correct` | `kalman.correct(observation)` | Точки движения: радар, визуально, movement |
| `attach_only` | **не вызывается** | Стационарные: перехват, взрыв, impact |

Узел `attach_only` всё равно попадает в `trajectory_nodes` (для карты и Kill/Pass), но не меняет `[vx, vy]` и не сбрасывает ковариацию по позиции как полноценное kinematic observation.

### Источник классификации

Приоритет (сверху вниз):

1. `status_dictionary.affects_kinematics` — boolean flag на `event_type` (новое поле, additive migration).
2. `extras.eventCategory` из LLM/parse:
   - `movement`, `threat` → `correct` (если есть lat/lon и не overridden)
   - `impact`, `all_clear`, `other` → `attach_only`
3. Явный denylist `event_type`: `pvo_report`, `cleared` → `attach_only`.

Таблица-ориентир (уточняется при импорте `status_dictionary`):

| event_type / category | mode |
|-----------------------|------|
| radar, visual, drone_sighting | `correct` |
| eventCategory=movement | `correct` |
| pvo_report | `attach_only` |
| eventCategory=impact | `attach_only` |
| взрыв / падение (impact codes) | `attach_only` |

### Инварианты

- Статическая точка **никогда** не вызывает `kalman.correct()`.
- Kinematic точка без lat/lon **не** участвует в Kalman (skip или attach с warning).
- Классификация выполняется **после** pre-collapse ([ADR-009](./adr-009-osint-pre-collapse.md)), на уровне схлопнутой ноды.

### SSOT

`packages/shared/src/domain/tracking/resolveNodeMode.ts`:

```typescript
type NodeMode = "correct" | "attach_only";

function resolveNodeMode(input: {
  eventType: string;
  eventCategory?: string | null;
  affectsKinematics?: boolean | null;
}): NodeMode;
```

---

## Не делаем

- Дублирование классификации на API read-side — mode хранится в `trajectory_nodes.mode`.
- Изменение LLM prompt на первом этапе — достаточно `eventCategory` + dictionary flag.

---

## Последствия

| Плюс | Минус |
|------|-------|
| Физически адекватная модель скорости | Нужна миграция `status_dictionary` |
| Нет ложных «остановок» цели | Ошибка классификации → плохой трек (нужен audit) |

---

## Критерии принятия

- Unit-тесты `resolveNodeMode` на все коды из таблицы.
- Integration: трек со статичной точкой (`attach_only`) посередине сохраняет velocity через узел.
