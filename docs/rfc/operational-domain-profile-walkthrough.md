# Пошагово: вынос домена БПЛА из кода (ODP)

Человеческое описание к [ADR-014](../adr-014-operational-domain-profile.md).  
Для кого: продукт, аналитика, разработка — чтобы понять **что меняем, зачем и в каком порядке**.

---

## 1. В чём проблема простыми словами

Сейчас «Радар» по сути заточен под **одну задачу**: Telegram-сообщения про БПЛА, ПВО, опасность, фиксации по регионам РФ.

Это не плохо для MVP — но **правила зашиты в TypeScript**:

- если в канале новая формулировка («беспилотник» вместо «БПЛА») — правим код и деплоим;
- если хотим кнопку нового типа на теплокарте — правим enum в shared;
- если завтра второй продукт «только ракеты» — придётся копировать репозиторий или плодить `if (бпла)`.

При этом **база уже умнее**, чем кажется:

- в БД есть `status_dictionary` (типы событий, уровни на карте);
- карта read-side уже читает словарь;
- facts (`parsed_events`) **нейтральны** — это просто строки в БД.

**Идея:** отделить **движок платформы** от **пакета домена «БПЛА OSINT»**, как мод в игре — ядро одно, настройки снаружи.

---

## 2. Метафора: три слоя

```text
┌──────────────────────────────────────────┐
│  Платформа (ядро)                        │
│  ingest → parse → facts → карта → API    │
│  Не знает слова «БПЛА»                   │
└──────────────────────────────────────────┘
                    ▲
                    │ подключается при старте
┌──────────────────────────────────────────┐
│  Domain Pack «uav_osint_ru_v1»           │
│  • какие слова = какой тип события       │
│  • какие типы показывать на теплокарте   │
│  • БПЛА vs ракета для треков             │
└──────────────────────────────────────────┘
                    ▲
                    │ лежит в git / data/
┌──────────────────────────────────────────┐
│  Файлы конфигурации (data/domains/…)     │
└──────────────────────────────────────────┘
```

---

## 3. Что такое Operational Domain Profile (ODP)

**ODP** — один JSON-файл «паспорт домена», например `uav_osint_ru_v1`:

| Поле в паспорте | Человеческий смысл |
|-----------------|-------------------|
| `title` | «БПЛА OSINT (РФ)» — для админки |
| `activeEventTypes` | какие типы событий **вообще участвуют** в этом домене |
| `uiPresets` | готовые наборы фильтров для карты (теплокарта, виджеты) |
| `threatProfileRules` | для треков: это скорее БПЛА, ракета или шар |
| `parserRulePackIds` | ссылка на файл с regex-правилами parse |
| `geoGroomingPackId` | как чистить строки («БПЛА по области …» → вырезать шум) |

**Один deployment = один активный ODP** (через env).  
Второй домен позже = **второй каталог** в `data/domains/`, без форка кода.

Пример черновика (не runtime): [data/domains/uav_osint_ru_v1/profile.manifest.example.json](../../data/domains/uav_osint_ru_v1/profile.manifest.example.json).

---

## 4. Где сейчас боль (конкретно)

| Место | Что не так | Пример |
|-------|------------|--------|
| `extractEventType.ts` | 30+ regex в коде | «фиксация … бпла» → `fixation` |
| `event-type.ts` | закрытый enum типов | добавить `new_type` = правка shared + деплой |
| `event-heatmap.ts` | 5 типов для кнопок heatmap | захардкожено, не из словаря |
| `geoCatalog.ts` | обрезка «БПЛА \| опасность \| …» | лексика домена в geo |
| Tracking (план) | uav/rocket/balloon в коде | должно быть из конфига |

**Что уже хорошо:** `status_dictionary` в БД, fold карты, API heatmap с фильтрами — туда и идём как к SSOT.

---

## 5. Что предлагается — по шагам (фазы D0–D5)

### Шаг 0 (D0) — договориться и описать ✅

**Что делаем:** ADR + skeleton файлов в `data/domains/`.  
**Результат:** все понимают границу «ядро / домен». Код пока **не обязан** меняться.

**Проверка:** можно прочитать manifest и объяснить нетехнарю, что в нём.

---

### Шаг 1 (D1) — вынести правила parse в файл

**Сейчас:** открываешь `extractEventType.ts`, добавляешь regex, коммитишь, деплой worker.

**Будет:**

1. Все правила лежат в `data/domains/uav_osint_ru_v1/parser-rules.v1.yaml` (или JSON).
2. Каждое правило: «если текст matches → тип `fixation`», с **приоритетом** (отбой раньше опасности).
3. Worker при старте **загружает файл** и прогоняет текст через него.
4. `extractEventType.ts` становится тонкой обёрткой (для совместимости), логика — в data.

**Пример одного правила (смысл):**

```yaml
- id: fixation_bpla
  priority: 30
  pattern: "фиксация.*бпла"
  eventType: fixation
```

**Зачем:** новая фраза из канала → правка YAML → `parser-rules:validate` → деплой **без** копания в TS.  
Golden tests те же: «этот текст → этот тип» — только источник правил другой.

**Риск:** один раз нужно **перенести** все текущие regex 1:1 и убедиться, что audit/reparse не поплыл.

---

### Шаг 2 (D2) — включить ODP при старте системы

**Сейчас:** worker и web «знают» домен implicitly — он в коде.

**Будет:**

1. В `.env`: `OPERATIONAL_DOMAIN_PROFILE_ID=uav_osint_ru_v1`.
2. При старте API/worker читают `profile.manifest.json`.
3. Появляется API: `GET /map/domain-profile/active` — web получает presets и метаданные.
4. CLI (как у phase manifest): `domain:manifest:import` — опционально в БД на v2.

**Зачем:** одна точка «какой домен сейчас включён»; staging может крутить другой pack без другой ветки git.

**Что видит пользователь:** пока ничего — это инфраструктура под следующий шаг.

---

### Шаг 3 (D3) — UI фильтры из конфига, не из const

**Сейчас:** кнопки теплокарты «фикс / ПВО / сбит …» зашиты в `EVENT_HEATMAP_FILTER_TYPES`.

**Будет:**

1. Web при загрузке карты: dictionary + active ODP.
2. Блок «Оперативные» на heatmap = preset `heatmap_operational` из manifest:
   - список типов: fixation, pvo_work, intercept, …
   - подписи — из `status_dictionary.title`, не хардкод.
3. Добавить тип на карту = правка **manifest + dictionary**, не `packages/shared`.

**Зачем:** parse, карта и UI **согласованы** — одни и те же коды типов из одного паспорта.

**Пример сценария:**

> Аналитик: «хочу видеть на теплокарте ещё `rocket_threat`»  
> Действие: добавить код в preset в JSON → redeploy config (или import) → кнопка появилась.

---

### Шаг 4 (D4) — ослабить жёсткий enum типов событий

**Сейчас:** TypeScript `z.enum(["fixation", "attention", …])` — компилятор не пустит новый тип.

**Будет (постепенно):**

| Подшаг | Что |
|--------|-----|
| E1 | В БД `event_type` уже string — формально OK |
| E2 | При записи parse проверяем: код есть в `status_dictionary` и в active ODP |
| E3 | Убираем enum из публичного API; фронт только dictionary-driven |

**Зачем:** новый тип события = строка в словаре + правило parse, **не** релиз monorepo.

**Важно:** делаем **не big-bang** — сначала D1–D3, потом E1→E3.

---

### Шаг 5 (D5) — треки: БПЛА/ракета/шар из конфига

**Сейчас (в SDD tracking):** в коде `resolveThreatProfile()` с литералами.

**Будет:**

1. В ODP блок `threatProfileRules`:
   - «если в тексте subject=drone → профиль uav»
   - «если event_type=rocket_threat → rocket»
2. Tracking worker читает правила при rebuild.
3. Физика (max скорость, max дистанция link) остаётся в коде — это **не лексика**, а модель движения.

**Зачем:** домен «ракеты-only» меняет mapping в JSON; Kalman-математика та же.

---

### Шаг 6 (параллельно D1) — geo grooming в pack

**Сейчас:** при разборе топонима строка «БПЛА по Саратовской…» чистится regex в `geoCatalog.ts`.

**Будет:** список префиксов для вырезания — в `geo-grooming.v1.yaml` домена.

**Зачем:** другой язык/домен — другой список шумовых слов, ядро geo не трогаем.

---

## 6. Как это стыкуется с Parse Workspace (RFC)

Будущий parse RFC: `raw → workspace → processors → facts`.

| Компонент | Откуда конфиг |
|-----------|---------------|
| EventTypeProcessor | тот же `parser-rules` pack (не второй набор regex) |
| GeoProcessor | geo pack + catalog |
| Finalizer | `status_dictionary` + GeoPolicy |

**Правило:** regex для типа события **в одном месте** — domain pack. Workspace только **оркестрирует**.

---

## 7. Типичный день после внедрения (story)

**Задача:** в канале пишут «беспилотник над городом», парсер не ловит.

| Шаг | Кто | Действие |
|-----|-----|----------|
| 1 | Аналитик | Показывает пример сообщения |
| 2 | Разработчик | Добавляет правило в `parser-rules.v1.yaml` |
| 3 | CI | `parser-rules:validate` + golden test |
| 4 | Ops | redeploy worker (или hot-reload config v2) |
| 5 | Ops | `reparse` / heal workspace по каналу |
| 6 | — | Новые facts с типом `attention` или `fixation` |

**Без:** правок `extractEventType.ts`, enum, пересборки shared (после D4).

---

**Задача:** на heatmap по умолчанию не показывать `pvo_report` (слишком шумно).

| Шаг | Действие |
|-----|----------|
| 1 | Убрать `pvo_report` из preset `heatmap_operational` в manifest |
| 2 | Web подхватит при следующей загрузке профиля |

---

## 8. Что НЕ меняется

- Цепочка facts: `raw_messages → parsed_events → event_locations`
- Time Machine, operational fold (ADR-006)
- Append-only: старые events не мутируем вручную
- `status_dictionary` остаётся — расширяем колонками, не выкидываем
- Tracking pipeline (Kalman, flow, fan) — только **источник** threat profile

---

## 9. Порядок работ (рекомендация)

```text
D0  документы + data skeleton          ← сейчас
D1  parser rules в YAML + loader       ← максимальный выигрыш, можно параллельно tracking
D2  ODP bootstrap + API профиля
D3  UI heatmap из presets
D4  enum → dictionary validation
D5  tracking threat rules из ODP
     geo-grooming pack — вместе с D1 или сразу после
```

**Не блокирует** tracking фазу 1: треки могут стартовать с временным hardcode, потом D5.

---

## 10. Критерии «мы сделали decouple»

- [ ] Новое regex-правило — только YAML + тест, без TS parse file
- [ ] Кнопки heatmap — из manifest + dictionary
- [ ] Env переключает profile id (даже если пока один pack)
- [ ] Reparse после смены rules воспроизводим (workspace/heal)
- [ ] Документация: «как добавить тип события» — одна страница runbook

---

## 11. Открытые решения (коротко)

| Вопрос | Предложение v1 |
|--------|----------------|
| YAML или JSON для rules? | YAML — правила читаются людьми |
| Редактор в админке? | Нет, только git + import |
| Несколько доменов на одном инстансе? | Позже, per-channel |
| Когда убить z.enum? | После D3, gate = все UI на dictionary |

---

## 12. Где физически лежит ODP (bundled vs on-prem)

**Коротко:** ODP — папка с JSON/YAML, не часть TypeScript. Можно **вшить в продукт** и можно **отдать заказчику**.

| Режим | Где лежит | Для кого |
|-------|-----------|----------|
| **Bundled** | `data/domains/` внутри repo / Docker image | dev, SaaS, «из коробки» |
| **On-prem** | `/opt/radar/domains/` на диске заказчика (volume) | закрытый контур, свои правила |
| **Hybrid** | в образе default + mount перекрывает | prod: стартовый pack + кастом без rebuild |
| **DB import (v2)** | таблица после `domain:manifest:import` | когда нельзя mount, только БД |

**Worker/API** при старте: `DOMAIN_PACKS_PATH` + `OPERATIONAL_DOMAIN_PROFILE_ID` → загрузили pack.  
**Web** pack с диска не читает — только API.

On-prem **не означает** fork репозитория: меняется каталог `domains/`, бинарники те же.

Подробнее: [ADR-014 § bundled vs on-prem](../adr-014-operational-domain-profile.md#где-живёт-odp-bundled-vs-on-premise).

---

## 13. Карта миграции: файл кода → куда переезжает

Легенда **«Куда»**:

| Метка | Смысл |
|-------|--------|
| **manifest** | `profile.manifest.json` |
| **parser-rules** | `parser-rules.v1.yaml` |
| **geo-grooming** | `geo-grooming.v1.yaml` |
| **content-kind** | `content-kind.v1.yaml` (v2 pack) |
| **pvo-stats** | `pvo-stats-rules.v1.yaml` (v2 pack) |
| **dictionary** | `status_dictionary` (БД) |
| **core** | остаётся в TypeScript (platform) |
| **loader** | новый код загрузки pack (D1–D2) |
| **refactor** | правка core без domain-логики |

### 13.1 Parse — `packages/worker/src/domain/parsing/`

| Файл | Что зашито доменом | Куда | Фаза |
|------|-------------------|------|------|
| `extractEventType.ts` | ~30 regex → `fixation`, `pvo_report`, «бпла»… | **parser-rules** (+ thin wrapper **core**) | D1 |
| `extractEventType.ts` → `extractEventSubject()` | drone / rocket / mws / aviation | **parser-rules** (subject rules) | D1 |
| `classifyContentKind.ts` | `EVENT_HINTS` с бпла/пво, `SUMMARY_PATTERNS` | **content-kind** v2; commercial noise частично **geo-grooming** | D2 backlog |
| `extractPvoStats.ts` | regex уничтожено N БПЛА/ракет, периоды | **pvo-stats** v2 | backlog |
| `channelCityListPromo.ts` | promo-паттерны каналов «Город 24/7» | **content-kind** или channel pack v2; v1 **core** OK | backlog |
| `parsePost.ts` | оркестрация parse | **core** (вызывает loaded rules) | D1 |
| `stripSignature.ts` | подписи каналов | **core** или **geo-grooming** v2 | — |
| `splitMessageBlocks.ts` | разбиение текста | **core** | — |
| `extractRepeatFlag.ts` | repeat | **core** (domain-agnostic) | — |
| `extractCounts.ts` | count | **core** | — |
| `extractDirection.ts` | direction | **core** | — |
| `extractMacroZone.ts` | macro zone | **core** / dictionary mapping | — |
| `resolveParsedEventActivation.ts` | active/clear | **core** + **dictionary** | — |
| `placeCatalogDedup.ts` / `HealRule` | geo catalog | **core** (geo, не БПЛА-лексика) | — |
| `placeEnrichmentStatus.ts` | enrich status | **core** | — |

### 13.2 Worker infrastructure

| Файл | Что зашито | Куда | Фаза |
|------|------------|------|------|
| `infrastructure/classifiers/ruleBasedEventClassifier.ts` | вызывает parsePost | **core** + inject pack | D1 |
| `infrastructure/geo-catalog/geoCatalog.ts` | strip `(?:бпла\|фиксация\|…)` | **geo-grooming** | D1 |
| `application/parsing/createParsePipeline.ts` | wiring classifier | **loader** inject ODP | D2 |

### 13.3 Shared contracts — `packages/shared/`

| Файл | Что зашито | Куда | Фаза |
|------|------------|------|------|
| `schemas/ingest/event-type.ts` | `z.enum([fixation, …])`, комменты про БПЛА | **refactor** → string + **dictionary** validate | D4 |
| `schemas/ingest/event-type.ts` → `eventSubjectSchema` | drone/rocket/mws enum | **dictionary** или pack subject codes | D4 |
| `schemas/ingest/event-type.ts` → `pvoStatsSchema` | drones/rockets/balloons | **core** schema; labels в **dictionary** | — |
| `schemas/map/event-heatmap.ts` | `EVENT_HEATMAP_FILTER_TYPES`, labels | **manifest** `uiPresets` + **dictionary** titles | D3 |
| `domain/tracking/threatProfile.ts` (planned) | uav/rocket literals | **manifest** `threatProfileRules` | D5 |
| `domain/tracking/profileKinematics.ts` (planned) | max velocity, gap | **core** (физика) | — |

### 13.4 API — `packages/api/`

| Файл | Что зашито | Куда | Фаза |
|------|------------|------|------|
| `map/map-query.service.ts` | `event_type = 'pvo_report'`, JOIN dictionary | **refactor** → flag `include_on_map` / category | D3 |
| `map/map.controller.ts` | validate token via `eventTypeSchema` enum | **refactor** → dictionary lookup | D4 |
| `events/entities/status-dictionary.entity.ts` | schema | **dictionary** + cols: `domain_profile_id`, `affects_kinematics`, `threat_profile` | D2 |
| *(new)* `domain-profile.controller.ts` | — | **loader** exposes **manifest** | D2 |

### 13.5 Web — `packages/web/`

| Файл | Что зашито | Куда | Фаза |
|------|------------|------|------|
| `widgets/map-heatmap/MapHeatmapControls.tsx` | `EVENT_HEATMAP_FILTER_TYPES` | API preset + **dictionary** | D3 |
| `shared/state/heatmapStore.ts` | filter from const | **refactor** → dynamic types | D3 |
| `widgets/geo-map/geoMapEffects.ts` | heatmap query | **core** (params from store) | D3 |
| `shared/api/mapApi.ts` | `pvoStats` drones field names | **core** DTO; semantics в pack | — |

### 13.6 Tracking (planned, SDD)

| Модуль (planned) | Что зашито | Куда | Фаза |
|------------------|------------|------|------|
| `resolveThreatProfile.ts` | event_type → uav/rocket | **manifest** rules | D5 |
| `resolveNodeMode.ts` | pvo_report → attach_only | **dictionary** `affects_kinematics` | фаза 1 tracking |
| `isDistinctDuplicate.ts` | tolerance | **core** + precision from facts | фаза 1 |
| `linkNodes.ts` / `innovationGate.ts` | profile kinematics | **core** physics | фаза 1 |

### 13.7 Сводка: один manifest vs полный ODP

```text
profile.manifest.json     ████░░░░░░  ~35% coupling
+ parser-rules.v1.yaml      ████████░░  ~75%
+ geo-grooming.v1.yaml      █████████░  ~85%
+ status_dictionary cols     █████████░  ~90%
+ loader + D3/D4 refactor   ██████████  ~95%
+ content-kind, pvo-stats v2          100% (edge cases)
```

**Остаётся в core навсегда (и это нормально):** fold engine, ingest, geo catalog match, Kalman math, block split, place dedup.

### 13.8 Пример одной строки текста — сколько файлов задействовано

Сообщение: *«Саратовская область \| Опасность по БПЛА»*

| Шаг | Было (файл) | Станет |
|-----|-------------|--------|
| 1. Noise? | `classifyContentKind.ts` | content-kind pack |
| 2. Тип события | `extractEventType.ts` | parser-rules |
| 3. Subject drone | `extractEventSubject()` | parser-rules |
| 4. Strip «Опасность по» | `geoCatalog.ts` | geo-grooming |
| 5. Уровень на карте | `status_dictionary.state_level` | dictionary (уже) |
| 6. Кнопка heatmap | `EVENT_HEATMAP_FILTER_TYPES` | manifest preset |
| 7. Threat profile трека | (planned) hardcode | manifest rules |

---

## См. также

- [ADR-014](../adr-014-operational-domain-profile.md) — архитектурное решение
- [ADR-014 § покрытие ODP](../adr-014-operational-domain-profile.md#покрытие-odp--один-manifest) — manifest ≠ всё
- [data/domains/README.md](../../data/domains/README.md) — где лежат файлы
- [parse-processor-workspace.md](./parse-processor-workspace.md) — будущий parse
