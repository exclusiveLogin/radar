# ADR-012: Geo-scan по каталогу БД без place_aliases

Дата: 2026-06-11  
Статус: **Accepted** (контракт; реализация — вместе с Parse Workspace, см. RFC)  
Связано: [ADR-004](./adr-004-region-place-ssot.md), [RFC parse-processor-workspace](./rfc/parse-processor-workspace.md), [geo-clean-rebuild](./runbook/geo-clean-rebuild.md)

## Контекст

Текущий parse-geo смешивает три несовместимых пути:

1. **Построчный fallback** (`extractFallbackCities` + `shouldSkipLine`) — отбрасывает строку целиком при токенах «сбит», «пво», «область» и т.д., хотя топоним в начале валиден.
2. **Узкие artifacts** (`places.json`, OSM Cities) — не покрывают ~128k НП; SSOT уже в БД из `03_all_cities.xlsx`.
3. **`place_aliases`** — накопление мусора при parse (`registerPlaceAlias`), ложные матчи, дублирование stem-логики.

Кейс **Таганрог**: город есть в БД (`kind=city`, stem `таганрог`), но catalog-step не находит его в one-liner из-за line-skip; при multiline с «и близлежащие» spawn идёт с сырой подписью канала вместо canonical place.

## Решение

### 1. SSOT каталога для scan

| Источник | Роль в parse |
|----------|----------------|
| **DB `places`** из `03_all_cities.xlsx` (tabular import) | **Primary** — full-text geo scan, stem resolve |
| **DB `places(kind=region)`** + `regions` | Субъекты РФ |
| **`places.json`** (frontline, шаг 2/4 import) | **Не** primary для обнаружения; hot-set / override координат и приоритетов на фронте, не полнота справочника |
| **OSM / artifacts** | Геометрия (`geo_feature`), не источник имён для spawn |

Parse **не обязан** иметь НП в `places.json`, чтобы распознать его в тексте.

### 2. GeoProcessor (spawning) — full-text capture + DB resolve

**Вход:** `groomedText` (после grooming; promo/footer уже вырезаны).

**Алгоритм (контракт v1):**

1. Токенизация `groomedText` с границами слов (как `toTokenHaystack` / longest-match).
2. Поиск **вхождений имён/stem из DB `places`** в тексте — **целиком**, не по части слова.
3. Для каждого hit: `resolvePlace(stem, regionScope, kindFloor)` → canonical `placeId`, `name`, `regionCode`.
4. Spawn `EventCandidate` с **canonical** anchor, не сырой подписью канала.

**Разрешение омонимов (много одинаковых stem в `03_all_cities`):**

| Условие | Правило |
|---------|---------|
| В workspace уже есть **region-candidate из текста** | `regionScope` = его `regionCode`; stem ищем **только в этом субъекте** |
| Region в тексте **нет** | `regionScope = null`; матч **только `kind=city`** (не ниже города: без `locality`, `settlement`, мелких НП) |
| Несколько hits после фильтра | **берём первый** по стабильной сортировке: `regionCode` ↑, `placeId` ↑ (см. §2.1); **новый place не создаём**, если в БД уже есть match |
| Match слабый (без scope, N>1 city) | spawn place + флаг **`geoImprecise: true`** (см. §2.2) — для LLM-enrich и подсказок на карте, **не** блокер spawn |
| **0 hits** (токен не в каталоге / опечатка) | place-anchor **не** spawn; region из текста — если есть; place может появиться на **enrich-фазе** (dadata/LLM) → re-finalize |

`regionScope` — не отдельная сущность: это region-candidate, распознанный в **том же** `groomedText`.  
Без scope сужаем не субъектом, а **уровнем НП** — городов с повторяющимися именами на порядки меньше, чем сёл.

**Ingest place при parse:** если stem resolve нашёл существующий `placeId` в каталоге — **только привязка**, create запрещён (как сейчас при `catalogHeal`, но по умолчанию для всех resolve-hit).

**`geoImprecise`** (не `geoAmbiguous`): маркер низкой уверенности disambiguation, не отказ от place.

**Где хранится (SSOT):**

| Этап | Поле |
|------|------|
| Workspace / candidate | `EventCandidate.extras.geoImprecise: true` |
| Facts после finalize | `parsed_events.extras.geoImprecise` (копия из candidate) |
| API / карта | читает `parsed_events.extras` → badge «точка неточная» |
| LLM lazy queue | приоритет сообщений с `geoImprecise` в workspace |

| Потребитель | Назначение |
|-------------|------------|
| LLM lazy phase | приоритет дообогащения / уточнение place |
| Карта / UI | badge «уточните точку» на маркере |
| Audit | доля imprecise по каналу |

#### 2.1 Порядок «первого» hit при омонимах

Один токен в тексте («Киров»), в БД несколько `kind=city` с тем же stem, `regionScope` нет:

1. Собрать все city-hits после фильтра.
2. Отсортировать **стабильно**: `regionCode` по возрастанию, затем `placeId`.
3. Взять **первый** элемент списка → spawn + `geoImprecise: true`.

Порядок **не** зависит от случайного порядка import в xlsx — только от канонических кодов/id.  
Если в тексте **несколько разных** топонимов — у каждого свой `span` и свой resolve (омонимия внутри одного токена).

#### 2.2 Явный район (`district`) — вне `kindFloor=city`

Паттерн `… район` в тексте (напр. «Неклиновский район») — **отдельный** scan, не ограничен `kindFloor=city`:

- spawn `anchor.kind` = district (или `city_district` по контракту kind);
- `regionScope` из текста, если область указана;
- без scope — district-hits по тому же правилу стабильной сортировки + `geoImprecise`, если N>1.

Сёла/посёлки (`locality`, `settlement`) без явного упоминания в тексте по-прежнему **не** матчатся при отсутствии `regionScope`.

**Пример:** «Киров» + «Кировская область» → scope `RU-KIR` → один city, `geoImprecise: false`.  
**Пример:** только «Киров», несколько city в БД → **первый** по §2.1, `geoImprecise: true`.  
**Пример:** «Таганрог» без области → один city → spawn, `geoImprecise: false`.  
**Пример:** «Таганрг» → 0 hits → place нет; enrich может добавить позже.

**Запрещено** как источник place-candidates:

- `shouldSkipLine` / line-noise filter на operational-тексте;
- запись ingest-alias при parse;
- матч только по `place_aliases`.

**Обязательные поля anchor:**

```typescript
anchor: {
  kind: "place" | "region";
  name: string;              // canonical из DB после resolve
  placeId?: string;
  regionCode?: string;
  span: {
    start: number;           // char offset в groomedText
    end: number;
    matchedText: string;     // как в тексте («Таганрог»)
  };
}
```

`matchedText` ≠ `name` допустимо (канальная обёртка); в facts идёт **canonical `name`**.

### 3. VicinityProcessor (enriching) — «и близлежащие»

Маркеры `близлежащие`, `пригород`, `ближайшее` **не** участвуют в match place.

- Читает `groomedText` + `candidates` + `span`.
- Ищет маркер рядом с place-candidate (по `span`, соседним токенам или block-context).
- Вешает trait `vicinity: true` / `scopeRadius` на **уже resolved** place (centroid из DB).
- Не создаёт отдельный place «Таганрог и близлежащие».

### 4. Deprecate `place_aliases` для parse-match

| Было | Стало |
|------|-------|
| `aliases.findByAlias` → place | `findByStemInRegion(stem, regionId)` + `findByFias` |
| `registerPlaceAlias` на каждый parse | **убрать**; алиасы не пишутся из ingest/parse |
| Region через alias-строку | `regions` + явное упоминание в тексте + locality-якоря (как `filterRegionsByTextContext`) |

Таблица `place_aliases` — **legacy**, удаление в отдельной миграции после:

1. `parse-engine:catalog:purge-garbage` / heal мусорных places;
2. `DELETE FROM place_aliases` (или wipe в geo rebuild);
3. вырезание кода `registerPlaceAlias` / `findByAlias` из `GeoValidationService`.

ADR-004 остаётся в силе для **модели region-as-place**; меняется только **стратегия матчинга** (stem вместо aliases).

### 5. Relations между candidates — позиция в тексте

Processors строят связи через `anchor.span` и список `candidates`:

- EventTypeProcessor — signal рядом с geo по offset / block;
- VicinityProcessor — маркер в окне N символов от `span` place;
- Finalizer — stable key `(rawMessageId, span.start, anchor.kind, eventType)` для upsert.

Повторный scan `groomedText` — допустимый fallback, но **SSOT связи** — offsets в workspace.

### 6. Что находится в тексте (ожидания)

**Находятся:**

- все топонимы из DB-каталога, которые **реально присутствуют** в `groomedText` как целые токены/фразы (longest-match для составных имён);
- омонимы без `regionScope`: **первый** city по §2.1 + `geoImprecise: true` (place **создаётся**, не откладывается);
- явные `… район` — district-scan по §2.2.

**Не находятся / без place-anchor на eager-фазе:**

- НП, которых нет в DB после tabular import;
- обрезанные/опечатанные формы (**0 hits**) — до fuzzy/enrich;
- `locality` / `settlement` без `regionScope` и без явного имени в тексте;
- фрагменты, вырезанные grooming (promo/footer).

Grooming **не** вырезает operational-слова («сбитие», «ПВО», «опасность») — geo-scan идёт по словарю имён, не по построчному skip.

### 7. Масштаб (~128k НП)

Scan по полному каталогу — через индекс имён (Aho-Corasick / trie по stems, кэш на `parser_revision`), не N×regex на каждое сообщение.

Hot-set из `places.json` — опциональное ускорение для frontline, не замена DB.

### 8. Geo-topography: collapse дублей place + region (не отказ от region)

После scan часто в одном сообщении одновременно:

- **place** — `Таганрог` (`kind=city`, `regionCode=RU-ROS` из DB);
- **region** — `Ростовская область` (`kind=region` / `regions`, тот же `RU-ROS` из текста).

Если субъект НП **совпадает** с явно распознанным субъектом в тексте:

```
place.regionCode === regionFromText.code
```

→ **схлопнуть только дубль** на этапе geo-topography (подшаг GeoProcessor / `GeoCollapseStep` после spawn):

| Действие | Смысл |
|----------|--------|
| **Оставить** place-candidate | SSOT точки: `placeId`, centroid |
| **Убрать** redundant region-candidate **из текста** | В тексте уже сказали и НП, и область — второй anchor на тот же субъект не нужен |
| **Provenance** | `regionConfirmedByText: true` на place |

**Collapse ≠ «не создавать region».**  
Finalizer **всегда** материализует субъект для operational-события. Источник region:

| В тексте | Откуда region в facts |
|----------|------------------------|
| Place + явная область (совпали) | `place.region_id` — collapse убрал дубль anchor, **region location/event всё равно есть** |
| **Только place** («Таганрог») | `place.region_id` — region **получается из place**, отдельного region-anchor в workspace не было |
| **Только region** в тексте | region-candidate из текста |

То есть при чистом «Таганрог» эвент/локация на область **создаётся** — не из второго anchor, а **из `place.region`** при materialize.

**Зачем collapse:**

1. Убрать дубли anchors / `event_locations`, когда текст явно дублирует субъект.
2. Стабильный SSOT: place несёт `regionCode`; следующий raw без области ведёт себя так же, как после collapse.
3. Traits клеятся к place; region в facts — производная от place или единственный region-anchor.

**Не схлопывать:**

| Ситуация | Поведение |
|----------|-----------|
| Только region в тексте, place не найден | region-candidate остаётся |
| Place и region **разные** коды | оба candidate остаются; **collapse не делаем**; `geoConflict: true` в workspace (см. §8.1) |
| Несколько place одного субъекта + один region в тексте | region-candidate схлопывается (один дубль на субъект) |
| Macro / multi-subject | region-candidates не схлопываются с чужим place |

**Примеры:**

```
Таганрог
Ростовская область
Опасность
```

Workspace после collapse: **1** place-anchor.  
Facts после finalize: **place** (Таганрог) + **region** (RU-ROS из `place.region`) — без дублирующего region-anchor из текста.

```
Таганрог
Опасность
```

Workspace: **1** place-anchor.  
Facts: **place** + **region из place.region** — то же поведение, что после collapse.

#### 8.1 Finalizer: `deriveRegionFromPlace`

При любом **place-candidate** с resolved `placeId` finalizer **обязан** добавить region в facts из `places.region_id`, даже если region-anchor в workspace не было:

```
deriveRegionFromPlace(placeCandidate) → region event_location / region facet
```

| Workspace | Facts после finalize |
|-------------|----------------------|
| 1 place, 0 region-anchor | place + **region из place.region** |
| 1 place + collapse (region был в тексте) | place + **region из place.region** (тот же субъект) |
| 0 place, 1 region-anchor | только region |
| `geoConflict` | place + region **из текста** (явный субъект); region из place.region **не подменяет** текстовый при конфликте |

Без этого «Таганрог» без области потеряет region в `event_locations`.

#### 8.2 `geoConflict`

Условие: `place.regionCode !== regionFromText.code` (оба anchor из одного сообщения).

| Действие | Смысл |
|----------|--------|
| Оба anchor **остаются** | Не схлопываем, не перезаписываем place регионом из текста |
| `workspace.geoConflict: true` | Флаг для audit / LLM / UI |
| Finalize | place-location + region-location по **текстовому** region-candidate; `geoImprecise: true` на place |

Пример: «Таганрог» + «Саратовская область» → place RU-ROS, region RU-SAM, `geoConflict: true`.

## Последствия

- Полный **reparse raw** после смены GeoProcessor + purge aliases/heal — восстанавливает привязки к canonical places.
- RFC [parse-processor-workspace](./rfc/parse-processor-workspace.md) — носитель контракта processors/finalizer; этот ADR — SSOT geo-match.
- Тесты-приёмки: фикстуры Таганрог (multiline, «и близлежащие», one-liner с «сбитие»/«ПВО»).
- Collapse: `Таганрог + Ростовская область` → один place-anchor в workspace; в facts — place + region из `place.region`.
- `Таганрог` без области → тот же итог в facts: region из `place.region`.

## Вне scope

- Удаление таблицы `place_aliases` в этой итерации (только deprecate в parse).
- Fuzzy/LLM-геокод как замена stem-scan (остаётся enrich-фаза); `geoImprecise` и **0 hits** — триггеры приоритета для enrich-очереди.
- Детальный радиус `scopeRadius` VicinityProcessor (метры/км) — в RFC processors.
