# Шпаргалка Radar (операции)

Краткий справочник команд и типовых сценариев. Подробности: [getting-started.md](./getting-started.md), [ingest-providers.md](./ingest-providers.md), [backfill-v2-pipeline.md](./backfill-v2-pipeline.md).

---

## Запуск

| Цель | Команда |
|------|---------|
| Первый раз | `Copy-Item .env.example .env` → `npm run cold:up` |
| UI + API (без Telegram) | `npm run up` |
| Полный стек + worker | `npm run dev` |
| Только UI + API | `npm run dev:app` |

**Проверка:**

| URL | Ожидание |
|-----|----------|
| http://127.0.0.1:3000/api/ready | `"status":"ready"` |
| http://127.0.0.1:5173 | OSINT-дашборд |
| http://127.0.0.1:3000/api/docs | Swagger |
| http://127.0.0.1:3000/api/worker/status | probe worker |

```powershell
node scripts/ws-smoke.mjs
curl.exe -s http://127.0.0.1:3000/api/map/snapshot | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);console.log('regions',j.regions?.length,'places',j.places?.length)})"
```

---

## Ingest: от нуля до live

**Минимум `.env`:**

```env
DATABASE_URL=postgresql://radar:radar@127.0.0.1:5432/radar
RADAR_STORAGE_MODE=db
RADAR_SESSIONS_DIR=.radar/sessions
```

### 1. Telegram-сессия

```powershell
npm run worker:session:deploy
npm run worker:session:probe
```

Слот по умолчанию: `tg-default-user` → `.radar/sessions/tg-default-user/`.

### 2. Каналы в PostgreSQL

```powershell
npm run ingest:manifest:import
```

**Bootstrap:** если `.radar/ingest.manifest.json` нет — CLI **сам создаёт** его из bundled-шаблона `docs/examples/ingest.manifest.radar-channels-mtproxy.json`.

**Каналы по умолчанию (4 шт.):**

| key | Telegram | title |
|-----|----------|-------|
| `radar-pf` | `@Radarpf` | Radar PF |
| `radar-russia` | `@radarrussiia` | Radar Russia |
| `radar-rvk` | `@radar_rvk` | Radar RVK |
| `radar-rrpfo` | `@RRPFO` | RRPFO |

Свой manifest: положить JSON в `.radar/ingest.manifest.json` или задать `RADAR_INGEST_MANIFEST`.

После import активировать provider (если `draft`):

```http
POST /api/admin/ingest/providers/{id}/start
```

### 3. Worker

```powershell
npm run worker:dev
```

В логах: `Режим хранилища worker: db`, `Запуск IngestOrchestrator`, `BackfillDaemon запущен`.

---

## Backfill (архив сообщений)

### CLI — разовая пачка (без job в БД)

**Все enabled каналы, по 100 сообщений:**

```powershell
npm run worker:ingest:backfill -- --all-bindings --batch-size=100
```

**Один канал** (UUID из SQL ниже):

```powershell
npm run worker:ingest:backfill -- `
  --provider-id="<uuid>" `
  --binding-id="<uuid>" `
  --batch-size=100
```

| Флаг | Назначение |
|------|------------|
| `--all-bindings` | Все enabled bindings подряд |
| `--batch-size=N` | Сообщений за один проход (default 200) |
| `--from-posted-at` / `--to-posted-at` | Фильтр по дате (ISO UTC) |

**Выход:** `Backfill chunk: { inserted, duplicates }` или `Backfill all: { bindings, inserted, duplicates }`.

**Инварианты:** live-cursor не двигается; дубликаты идемпотентны; каждое новое сообщение проходит parse (LLM может занять ~20 мин на 400 msg).

### Backfill V2 — демон (полная история)

1. Worker в `db` mode, `BackfillDaemon` включён.
2. `POST /api/admin/ingest/backfill-jobs` с `bindingId` + `strategy: "all"`.
3. Статус: `ingest_backfill_jobs.status` → `pending` → `running` → `completed`.

Подробно: [backfill-v2-pipeline.md](./backfill-v2-pipeline.md).

---

## Полезный SQL

**Bindings + provider id:**

```sql
SELECT p.id AS provider_id, b.id AS binding_id, b.binding_key, c.key AS channel_key
FROM ingest_bindings b
JOIN ingest_providers p ON p.id = b.provider_id
LEFT JOIN channels c ON c.id = b.channel_id
WHERE b.enabled = true;
```

**Сырые сообщения backfill:**

```sql
SELECT ch.key, count(*) FROM raw_messages rm
JOIN channels ch ON ch.id = rm.channel_id
WHERE rm.ingest_mode = 'backfill'
GROUP BY ch.key;
```

**Последние raw по каналу:**

```sql
SELECT rm.posted_at, rm.ingest_mode, left(rm.raw_text, 120)
FROM raw_messages rm
JOIN channels ch ON ch.id = rm.channel_id
WHERE ch.key = 'radar-rrpfo'
ORDER BY rm.posted_at DESC LIMIT 10;
```

---

## Карта и parse

| Задача | Команда |
|--------|---------|
| Пересчёт проекций из raw | `npm run worker:reparse:raw` |
| Сброс карты + очередей фаз (raw сохранить) | `npm run reset:pipeline` |
| TTL-sweep статусов | `npm run worker:map-state:expire` |
| Оффлайн-тест парсера | `npm run worker:parse:report -- --input tests` |
| Snap + LLM | `npm run worker:parse:snap:ollama -- --input tests/snap_001.txt` |
| A/B catalog vs llm | `npm run parse:ab -- --input tests` |
| Bootstrap golden set | `npm run parse:golden:bootstrap -- --input tests` |
| Скоринг по golden | `npm run parse:score -- --input tests` |

**TTL:** `RADAR_MAP_STATE_TTL_HOURS` (default 24), sweep по `status_event_at` / `meta.statusEventAt` (не `updated_at`); проекция **не применяет** `MessageParsed` с `postedAt` старше окна (reparse не воскрешает отбой). Daemon в worker db mode.

---

## Async-обогащение (фазы, ADR-003)

**Phase-pipeline v2:** фазы `catalog|llm|dadata|nominatim`, очередь `phase_coverage`,
оркестратор `PhaseRunner` + `PhaseDaemon`. Подробно: [phase-pipeline.md](./phase-pipeline.md).

```powershell
npm run migration:run
npm run phase:manifest:import
npm run phase:manifest:export
```

| trigger | Поведение |
|---------|-----------|
| `eager` | После ingest/reparse — inline catalog (по `order`) |
| `scheduled` | PhaseDaemon, `intervalMs`, batch из coverage |
| `manual` | `worker:phase:run`, админка Run |

```powershell
npm run worker:phase:run -- --phase=llm --batch=100 [--watch]
npm run worker:enrich:run -- --stage=llm   # алиас
npm run worker:reparse:raw                 # invalidate + ingest-поток (не прямой catalog)
```

**Прогресс:** `GET /api/admin/phases/runs/overview` (coverage per phase), виджет «Фазы».

**Env:** `RADAR_STORAGE_MODE=db`, `RADAR_PHASE_DAEMON_ENABLED` (scheduled).

**LLM:** `RADAR_LLM_PROVIDER`, `RADAR_LLM_API_KEY`, …

Статус внедрения: [phase-pipeline-status.md](./phase-pipeline-status.md).

### Админка фаз

Виджет **«Фазы обогащения»** + REST `/api/admin/phases/*` — см.
[api/phases-admin.md](./api/phases-admin.md).

---

## Web UI (OSINT shell)

**Layout:** карта фоном, glass-рейлы слева/справа, header (UTC, LiveBadge, тема, ⚙ виджеты).

**Правый рейл** — панели **свёрнуты по умолчанию** (развернуть ▾ в шапке виджета).

| Виджет | Зона | Данные |
|--------|------|--------|
| Гео-карта | фон | MapLibre + WS |
| Обзор (KPI + donut) | left | `regionsByCode$` |
| Схема | left | `layout.json` — все 89 субъектов РФ (+ Крым, Севастополь, ДНР/ЛНР/Запорожье/Херсон); `npm run geo:layout:build` |
| Активные угрозы | right | active region/place |
| Лента изменений | right | `region_state_history` |
| **Сообщения** | right | `GET /api/map/messages/recent` |
| Топ активности | right | activity |
| Динамика | right | sparkline warnings |
| Каналы | right | ingest providers |
| Система | right | WS + DB + worker probe |

**Realtime:** `GET /api/map/snapshot` → WS `/ws` (`region-state`, `place-state`, `warning`).

---

## Диагностика

| Симптом | Действие |
|---------|----------|
| Ingest не в БД | `RADAR_STORAGE_MODE=db`, перезапуск worker |
| Нет каналов | `npm run ingest:manifest:import`, provider `active` |
| Backfill pending | worker db + `BackfillDaemon запущен` |
| Карта пустая после ingest | `npm run worker:reparse:raw` (инвалидация + ingest-поток, не прямой catalog) |
| API_ID_INVALID | свои `TELEGRAM_API_ID/HASH` с my.telegram.org |
| `[api] EBUSY` при `npm run dev` | остановить все `node`/dev; удалить `packages/api/dist`; репо в OneDrive — пауза синхронизации или вынести клон из OneDrive; `nest-cli` без `deleteOutDir` |
| CLI прогресс «листает» строки | `ParseAttemptLogger` больше не пишет в stdout при баре; подробности: `RADAR_VERBOSE_PARSE_LOG=1` → stderr |

**CLI с live-progress (`cli-progress`):** `reset:pipeline` — нет; `reparse:raw`, `phase:run`, `ingest:backfill` (по сообщениям), `parse:score/ab`, `golden` — да. Лаборатория `parse:snap/report` — без бара. **Админ-логи parse** — из БД `parse_attempts` (не из stdout CLI).

```powershell
# EBUSY: освободить dist перед повторным dev
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item -Recurse -Force packages\api\dist -ErrorAction SilentlyContinue
npm run dev:app
```

```powershell
node scripts/query-ingest-status.mjs
```

---

## Экспорт / import manifest

```powershell
npm run ingest:manifest:export   # БД → .radar/ingest.manifest.json
npm run ingest:manifest:import   # JSON → БД (upsert channels)
```
