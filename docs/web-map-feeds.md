# Web: ленты «Сообщения» и «Лента изменений»

SSOT контрактов read-side для правого рейла. Связано: [adr-006-map-read-line-fold.md](./adr-006-map-read-line-fold.md), [shpargalka-operacii.md](./shpargalka-operacii.md).

---

## Разделение (2026-06-20)

Две панели — **два API и два store** на фронте. Не derived-поток из одного endpoint.

| Панель | API | Store (`packages/web`) | Смысл |
|--------|-----|------------------------|--------|
| **Сообщения** | `GET /api/map/messages/recent` | `messagesStore` → `messagesFeed$` | Все **mat_ingest_raw**, parse опционален |
| **Лента изменений** | `GET /api/map/events/recent` | `stateChangesFeedStore` → `stateChangesFeed$` | Только **parsed_event + mat_parse_location** |

Poll: сообщения ~20 с, лента изменений ~15 с (`startMessagesStore` / `startStateChangesFeedStore` в `AppShell`).

---

## Сообщения (`/map/messages/recent`)

- **1 строка = 1 raw_message** (без дублей от N `mat_parse_event` на один raw).
- Без фильтра «только с loc» — в ленте и шум, и неразобранное, и mass-clear без EL.
- Поля `MessageFeedItem`:
  - `contentKind` — `event` \| `noise` \| `meta` (эвристика `classifyContentKind` в `@radar/shared`, считается на API).
  - `parsedEventCount`, `hasLocations` — агрегат по active `mat_parse_event`.
  - `eventType`, `stateLevel`, `regionCodes` — сводка parse (если есть).

### Бейджи в UI

| Условие | Бейдж |
|---------|--------|
| `contentKind=noise` | `шум` |
| `contentKind=meta` | `meta` |
| `parsedEventCount=0` | `raw` |
| разобрано, есть `stateLevel` | `Badge` (в т.ч. **green** для `cleared` без loc) |
| разобрано, есть `eventType`, нет level | текст типа (`cleared`, …) |
| parse без типа и без loc | `parse` |

Кнопка ⏱ — `setHistoricalAsOf(postedAt)` (Time Machine).

---

## Лента изменений (`/map/events/recent`)

- **Loc-oriented:** обязателен `INNER JOIN mat_parse_location` (1 карточка = 1 `parsed_event` с loc).
- **Без фильтра по типу события:** сняты ограничения `state_level <> 'grey'` — в ленту попадают `cleared`, `rocket_threat` и др., если есть EL.
- **Не попадают:** канальный mass-clear **без** строк в `mat_parse_location` (например «Отбой … по всем ранее объявленным регионам») — такие отбои видны в **Сообщениях** и на **карте** (синтетика `loadChannelClearFacts` в read-fold), но не в loc-ленте.

---

## Карта vs ленты

| Слой | Логика |
|------|--------|
| **Карта** | LastWinner fold на `now` / `asOf` — побеждает более новый факт (clear после raise → green). |
| **Лента изменений** | Хронология **событий с loc**, не текущий winner. |
| **Сообщения** | Хронология **raw**, не fold. |

---

## Shared: `classifyContentKind`

- Путь: `packages/shared/src/domain/parsing/classifyContentKind.ts`
- Worker: re-export из `@radar/shared` (`packages/worker/.../classifyContentKind.ts`).
- API: метка `contentKind` для ленты сообщений (read-side label, не write-path groom).

Coupling: общая эвристика noise/meta/event для API и worker; **контракты лент разведены** — web не склеивает потоки на Rx-уровне.

---

## Код

| Слой | Файлы |
|------|--------|
| API | `packages/api/src/map/map-query.service.ts` — `getRecentMessages`, `getRecentStateChangeEvents` |
| Web store | `messagesStore.ts`, `stateChangesFeedStore.ts` |
| UI | `MessagesFeedWidget.tsx`, `StateChangesWidget.tsx` |
