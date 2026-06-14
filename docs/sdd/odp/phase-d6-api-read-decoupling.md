# SDD: ODP — Фаза D6 — API read-side decoupling

Статус: **ready for planning**  
ADR: [014 § API read-side](../../adr-014-operational-domain-profile.md#api-read-side-decoupling-фаза-d6)

**Критерий входа:** D2 active profile API; D4 dictionary validation.

---

## 1. Проблема

ODP без D6 остаётся **полноценным доменным контрактом в HTTP**: маршруты и SQL с литералами (`pvo_report`), Swagger с `z.enum`, виджеты с domain-именами. Новый домен = правка API — **нельзя**.

---

## 2. Принципы

| # | Правило |
|---|---------|
| R1 | Read API **не знает** семантику домена — только `status_dictionary` + active ODP |
| R2 | Нет маршрутов вида `/map/<domain-concept>` — только generic + query flags |
| R3 | Валидация query: код ∈ `activeEventTypes` ∪ dictionary, не TS enum |
| R4 | OpenAPI examples из active profile, не из hardcode |
| R5 | Write-path (ingest/parse) — отдельно; read decouple не блокирует ingest |
| R6 | **Нет auto-endpoints из manifest** — см. [ADR-014 § замыкание API](../../adr-014-operational-domain-profile.md#как-api-замыкается-на-odp-без-автоэндпоинтов) |

---

## 2.1 Замыкание: shared loader + inject (не codegen)

```text
packages/shared/domain/domain-profile/  → DomainProfileContext
packages/api/map/domain-profile/        → Nest provider, assertQueryable*
Generic controllers                     → heatmap, event-feed, tracks (URLs фиксированы)
```

Manifest меняет **политику фильтрации**, не таблицу маршрутов.

## 3. Миграция endpoint'ов

| Сейчас (coupling) | Целевое (generic) |
|-------------------|-------------------|
| `GET /map/pvo-reports` | `GET /map/event-feed?feedKind=macro_report` |
| `eventTypes=fixation,pvo_work` в Swagger | `eventTypes` из `GET /map/domain-profile/active` + dictionary |
| SQL `WHERE event_type = 'pvo_report'` | `JOIN status_dictionary` + `feed_kind = 'macro_report'` |
| `pvoStatsSchema` в public DTO | `extras` schema по `dictionary.extras_schema` (v2) или opaque JSON |

**BC v1:** старый `/map/pvo-reports` → thin alias на generic feed + `@deprecated` в OpenAPI.

---

## 4. Dictionary columns (additive)

```sql
ALTER TABLE status_dictionary
  ADD COLUMN IF NOT EXISTS feed_kind text,           -- map | macro_report | hidden
  ADD COLUMN IF NOT EXISTS map_surface text[];       -- heatmap, timeline, tracks
```

Seed для текущего домена: `pvo_report.feed_kind = 'macro_report'`, `pvo_work.map_surface = '{heatmap}'`.

---

## 5. API SSOT

```typescript
/** Валидация eventType query против active ODP + dictionary. */
async function assertQueryableEventTypes(
  codes: string[],
  ctx: DomainProfileContext,
): Promise<void>;

/** Generic macro/report feed — без domain literals в service. */
async function listEventFeed(params: {
  feedKind: string;
  limit: number;
  since?: string;
}): Promise<EventFeedItem[]>;
```

Location: `packages/api/src/map/domain-profile/` (shared with D2 loader).

---

## 6. Web

| Было | Станет |
|------|--------|
| `mapApi.pvoReports()` | `mapApi.eventFeed({ feedKind: 'macro_report' })` |
| `PvoReportsWidget` hardcoded title | title из ODP `uiPresets` / dictionary |
| `pvoReportsStore` | `eventFeedStore` (generic) |

---

## 7. DoD checklist

- [ ] Нет литералов domain event types в `map-query.service.ts` SQL
- [ ] `GET /map/event-feed` работает по `feed_kind`
- [ ] `/map/pvo-reports` deprecated alias (1 release)
- [ ] Swagger не ссылается на closed enum event types
- [ ] Web feed widget title из dictionary/ODP

---

## 8. Коммиты

| # | Содержание |
|---|------------|
| C1 | migration feed_kind + seed |
| C2 | generic event-feed service + controller |
| C3 | deprecate pvo-reports + web store rename |
