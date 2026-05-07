# Runtime validation report (2026-05-07)

## Scope

- ОС и shell: Windows 10 + PowerShell.
- Цель: проверить запуск dev-окружения без Telegram, миграции, geo-пайплайн, probe/health/api ручки, web-заглушку и parser snapshots.

## Executed flow

1. Запущен Docker Desktop (daemon был выключен).
2. Выполнено `npm run db:up`.
3. Выполнено `npm run migration:run` (применены все новые миграции).
4. Выполнено `npm run geo:vendor` (загружены внешние geo-источники).
5. Выполнен geo-пайплайн: `geo:sync -> geo:verify -> geo:seed -> geo:db:plan -> geo:db:apply`.
6. Запущено `npm run dev:app` (shared + api + web, без worker/Telegram).
7. Прогнаны HTTP-проверки API и web.
8. Прогнан parser CLI по `tests/snap_001..003.txt` с `--geo-report`.

## Service health and API checks

- `GET http://127.0.0.1:3000/api/health` -> `200`.
- `GET http://127.0.0.1:3000/api/ready` -> `200`, database = true.
- `GET http://127.0.0.1:3000/api/docs` -> `200`.
- `GET http://127.0.0.1:3000/api/events?limit=3` -> `200`, body `[]`.
- `GET http://127.0.0.1:3000/api/regions?limit=3` -> `200`, данные регионов присутствуют.
- `GET http://127.0.0.1:3000/api/admin/geo-sync?limit=3` -> `200`, есть запись последнего sync.
- `GET http://127.0.0.1:3000/api/places/status?limit=3` -> `200`, body `[]`.
- `GET http://127.0.0.1:3000/api/places/status/history?limit=3` -> `200`, body `[]`.

## Front stub checks

- `GET http://localhost:5173/` -> `200` (Vite app отвечает).
- `GET http://localhost:5173/api/health` -> `200` (прокси в API работает).
- `GET http://127.0.0.1:5173/` в этой сессии не отвечает, при этом `localhost` отвечает стабильно.

## Database and geo artifacts checks

- `geo:sync`: создано/обновлено 108 артефактов.
- `geo:verify`: 108/108, ошибок 0.
- `geo:seed`: в `geo_dataset_file` записано 108 строк.
- `geo:db:apply` (по логу): region.added=86, place.added=4531, alias.added=4619.
- Фактические counts в БД после apply:
  - `regions=86`
  - `places=0`
  - `place_aliases=0`
  - `geo_dataset_file=108`
  - `geo_sync_log=1`

## Parser snapshots and area matching readiness

- Итоговые сводки вынесены в `reports/runtime/parser-snapshots-summary.json`.
- Классификация событий на snapshots работает (eventShare от 0.7333 до 0.8933).
- По `--geo-report` во всех снапшотах:
  - `known=0`, `created=0`, `rejected=all events`.
- Вывод по матчингу области на snapshot CLI:
  - обвязка проверки есть;
  - полноценно проверить матчинг пока нельзя, т.к. текущий snapshot CLI использует `NoopEnricher` и не формирует валидные location candidates.

## Fixes applied during validation

- Исправлен read-side роутинг: убран двойной префикс, ручки работают как `/api/events`, `/api/regions`, etc.
- Исправлена регистрация entity в read-side модуле, чтобы read-side запросы не падали с `EntityMetadataNotFoundError`.

## Current status

- Dev-окружение без Telegram поднимается и работает.
- Probe/health/docs/API read-side ручки доступны.
- Front-заглушка работает (через `localhost:5173`) и проксирует API.
- Geo-артефакты скачиваются/валидируются/сидятся.
- Есть функциональный разрыв: `geo:db:apply` рапортует заполнение places/aliases, но фактически таблицы пустые.
