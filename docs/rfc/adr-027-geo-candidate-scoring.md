# ADR-027: Весовая модель geo-кандидатов (score → materialize gate)

Дата: 2026-08-03  
Статус: **Proposed** · Implementation in progress  
Связано: [ADR-012](../adr-012-geo-scan-without-aliases.md), [ADR-004](../adr-004-region-place-ssot.md), [parse-processor-workspace](./parse-processor-workspace.md)

## Контекст

ADR-012 фиксирует: слабый матч (омоним без `regionScope`) **spawn’ится** с `geoImprecise: true`, а не отбрасывается.  
`geoConflict` оставляет оба anchor и только ставит флаг.

На практике этого недостаточно:

1. **Морфологический false positive** — «Северский» (район Краснодарского края) через эвристику `…ский → …ск` резолвится в город **Северск** (RU-TOM). Stem уникален → `geoImprecise: false`, companion-scope не режет.
2. **Минорный регион на фоне кластера** — перечисление НП одного субъекта + одиночный чужой hit → отдельный region facet и карточка на карте.
3. **Threat-тип глобален** — `danger`/`rocket_threat` вешается на всех кандидатов сообщения; ложный гео-hit получает тот же статус.

Нужна непрерывная модель уверенности **на уровне geo-кандидата**, а не бинарный отказ на spawn.

## Решение

### Разделение spawn / score / materialize

| Этап | Поведение |
|------|-----------|
| **Spawn** (GeoProcessor) | Без изменений ADR-012: кандидат всегда создаётся; сигналы пишутся в `extras` |
| **Score** (`runGeoCandidateScoring`) | Чистая функция × YAML-матрица → `extras.geoScore` + `extras.geoScoreBreakdown` |
| **Materialize** (`planFinalizeMerge`) | Тупой gate: `geoScore >= threshold` (если score есть и gate enabled) |

Spawn-контракт ADR-012 **не меняется**. Порог режет только facts/API (карточки), workspace/LLM-очередь видят всех кандидатов.

### SSOT матрицы

Файл: [`data/parse/geo-score.v1.yaml`](../../data/parse/geo-score.v1.yaml)

- `base` — стартовый score
- `factors.*` — вклады boolean/scaled факторов
- `majorityClusterMin` — порог «явного кластера» другого региона
- `materializeGate.enabled` / `materializeGate.threshold` — включение и отсечка

Loader: `geoScoreMatrixRegistry.ts` (кэш + revision hash), паттерн как у `parse-processors.v1.yaml`.

### Факторы v1

| Фактор | Сигнал | Знак |
|--------|--------|------|
| `uniqueStem` | `stemPoolSize === 1` после kind/region filter | + |
| `imprecise` | `extras.geoImprecise` / N>1 без scope | − |
| `adjectiveStem` | матч через `…ский→…ск`, не буквальный stem | − |
| `minorityRegion` | region кандидата минорен при кластере ≥`majorityClusterMin` другого ISO | − |
| `geoConflict` | `namespaces.geoConflict` и region кандидата ∉ явных субъектов текста | − |
| `channelPromo` | `isChannelCityListPromo(groomedText)` | − |
| `llmConfidence` | scaled: `weight * (llmConfidence - 0.5) * 2` | ± |

LLM **не судья**: только входной сигнал (`places[].confidence` / `reason`). Пересчёт — той же Domain-функцией.

### Формула

```
score = clamp(base + Σ factorContribution, 0, 2)
```

Boolean-фактор: `when === true → weight`, иначе `0`.  
Scaled (`llmConfidence`): вклад только если значение задано.

### Gate

```typescript
isCandidateGeoScoreAcceptable(extras, matrix):
  if !matrix.materializeGate.enabled → true
  if typeof extras.geoScore !== "number" → true  // heal/legacy без score
  return extras.geoScore >= matrix.materializeGate.threshold
```

Рядом с `isCandidateGeoValid` в `planFinalizeMerge` — без ветвящейся бизнес-логики.

### Сигналы на spawn (extras)

| Поле | Источник |
|------|----------|
| `geoImprecise` | ADR-012 (как сейчас) |
| `matchedViaAdjectiveStem` | `resolveStemToEntry` |
| `stemPoolSize` | размер filtered pool |
| `llmConfidence` / `llmReason` | `llmProcessor` ↔ `artifact.llm.nodes` |
| `geoScore` / `geoScoreBreakdown` | `runGeoCandidateScoring` |

## Rollout

1. **v1**: gate enabled, threshold подобран так, чтобы резать `adjectiveStem + minorityRegion` (кейс Северск/Кубань), не трогая одиночный unique city.
2. Дальнейшая калибровка — **только YAML** (без правки кода).
3. При сомнении временно `materializeGate.enabled: false` — audit: score пишется, materialize не режется.

## Последствия

- Ложные region facets от омонимов/морфологии отсекаются на materialize.
- Карта/API не получают минорный регион при явном кластере другого.
- LLM может снижать `confidence` по промпту; вес в матрице — единая точка правды.
- ADR-012 spawn / `geoImprecise` / `geoConflict` остаются в силе.

## Вне scope

- Отдельный MCP/сервис перевзвешивания.
- Per-eventType пороги (YAGNI).
- Ленивый LLM re-finalize как отдельный контур (уже существующий phase_enrich).
- Кейс RU-IRK «Поволжье» — отдельная фикстура после полного текста сообщения.
