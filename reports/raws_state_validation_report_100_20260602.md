# Валидация raws vs текущие статусы (окно 100 сообщений)

Дата генерации: `2026-06-02T08:51:53Z`

Артефакты:
- snapshot: `reports/raws_state_snapshot_100_20260602.jsonl`
- replay/diff: `reports/raws_state_validation_result_100_20260602.json`

## 1) Окно данных

- `raw_messages`: 149
- Окно сверки: последние 100 raw по `posted_at DESC`
- Нижняя граница окна: `2026-06-01 18:48:47+00`
- Сравнено регионов: 55
- Mismatch: 12

## 2) Метод сверки

Dry-run replay повторяет логику проекции:
- `computeSelfLevel` (sticky: green сбрасывает, меньшая тревога не понижает alarm)
- `computeEffectiveLevel` (neighbor-red -> yellow только для `self=grey`)
- уровни по `status_dictionary`

Ограничение сверки:
- replay построен по текущим `parsed_events + event_locations` в окне 100 raw.
- если состояние менялось вне окна / служебным reset / sweep, это попадёт в mismatch.

## 3) Mismatch (ключевые)

### 3.1 Ложно зелёные относительно последних угроз в окне

| ISO | expected | actual | Последняя угроза (raw) |
|---|---|---|---|
| RU-BEL | red | green | `14842201-b971-4cd6-b853-6500f3172516` (`danger`, 2026-06-02 05:07:45) |
| RU-KDA | red | green | `60c95434-a743-4d01-8186-4439f99c42d9` (`pvo_work`, 2026-06-02 01:16:01) |
| RU-KLU | red | green | `313f93be-6088-4950-8e9c-49ca7deda9a5` (`danger`, 2026-06-01 23:50:27) |
| RU-NGR | red | green | `5f271684-12ca-41d5-8e79-afe5b9496e73` (`danger`, 2026-06-01 19:40:25) |
| RU-TVE | red | green | `a952cab4-546a-4453-8fe9-9de130b54adf` (`danger`, 2026-06-01 19:16:30) |

Наблюдение:
- в `region_state_history` есть последующие green переходы (`reason=self:green`) после этих угроз.
- часть green-переходов связана с raw-отбоями; часть выглядит как системная коррекция/очистка.

### 3.2 Ложно жёлтый

| ISO | expected | actual | Деталь |
|---|---|---|---|
| RU-SAM | red | yellow | `reason=ttl:24h` в `region_state_active` (исторический TTL-sweep удерживает yellow) |

### 3.3 Neighbor-red ожидается, но регион grey/green

| ISO | expected | actual | Комментарий |
|---|---|---|---|
| RU-CR | yellow | grey | в истории есть колебания `neighbor-red <-> grey`, текущее `self:grey` |
| RU-AD | yellow | grey | аналогично |
| RU-YAR | yellow | grey | в моменте нет активного red-соседа в self-layer |
| RU-MOS | yellow | green | `self:green` приоритетнее neighbor-red |

### 3.4 Красные ISO вне текущей модели adjacency/expected

| ISO | expected | actual | Гипотеза |
|---|---|---|---|
| UA-43 | grey | red | legacy/alias ISO для Крыма, живёт отдельно от `RU-CR` |
| RU-SE | grey | red | legacy/alias для Севастополя (`RU-SEV` в текущем словаре) |

## 4) Проверенные raw-примеры (ручная валидация)

- BEL угроза: `14842201-b971-4cd6-b853-6500f3172516`  
  Текст: «Белгородская область, ракетная опасность»
- BEL отбой: `47d83df3-93c8-4fd8-9158-b51d23bb2b30`  
  Текст: «Белгородская область — отбой ракетной опасности»
- KDA угрозы:  
  `60c95434-a743-4d01-8186-4439f99c42d9`, `23a9a732-139a-44a2-a495-35b95eb949c9`, `18850ca0-287b-4357-82ff-d41fde6c2660`

## 5) Root-cause классы расхождений

1. **Окно 100 raw vs текущее состояние:** текущее `region_state_active` уже сдвинуто поздними green/TTL событиями.
2. **TTL-sweep:** локально удерживает `yellow` (пример RU-SAM), даже если replay по угрозам ожидает red.
3. **Alias ISO:** `UA-43`, `RU-SE` дают расхождение с моделью adjacency на `RU-CR`, `RU-SEV`.
4. **Neighbor-red чувствителен к self-layer:** если `self=green`, соседняя превентивная yellow не применяется.

## 6) Рекомендация для следующей итерации валидации

- Запускать replay не только по raw/parsed, а по полному eventsource: `MessageParsed` + служебные reset/sweep события.
- Нормализовать alias ISO (`UA-43 -> RU-CR`, `RU-SE -> RU-SEV`) до сравнения expected/actual.
- Вынести отчёт в регулярный скрипт с двумя режимами:
  - `window=100 raw`
  - `window=24h region_state_history`
