# Шпаргалка: dev, очереди, reparse, сброс

Кратко, без теории. PowerShell, корень репо. Нужны `DATABASE_URL`, `RADAR_STORAGE_MODE=db`, Postgres.

Полный справочник: [cheatsheet.md](./cheatsheet.md) · фазы: [phase-pipeline.md](./phase-pipeline.md)

---

## Запуск

| Что | Команда |
|-----|---------|
| Всё (api + web + worker) | `npm run dev` |
| Без worker | `npm run dev:app` |
| Проверка API | `Invoke-WebRequest http://127.0.0.1:3000/api/ready -UseBasicParsing` → 200 |

**Первый старт `dev`:** 1–2 мин (сборка). Worker стартует **после** `/api/ready`.  
**Ошибка worker «API dist не найден»** — api ещё не собрался; перезапусти `npm run dev` или сначала `npm run build -w @radar/api`.

**Шум в логе web:** `ws proxy ECONNRESET` / `ECONNABORTED` — обрыв WebSocket, обычно не ломает UI.

| URL | |
|-----|---|
| UI | http://localhost:5173 |
| API | http://127.0.0.1:3000 |

---

## Очереди — как устроено (30 секунд)

```
raw_messages  →  phase_coverage (raw + phase_id + status)  →  парс  →  parsed_events
places        →  place_enrichment_jobs (place + provider)     →  geo   →  places.evidence_providers
```

| Таблица | Одна строка = |
|---------|----------------|
| `phase_coverage` | «сообщение X в фазе catalog/llm/…» (`pending` → `done`) |
| `phase_runs` | журнал одного прогона фазы (не очередь сообщений) |
| `place_enrichment_jobs` | «место Y обогатить dadata/llm» (не привязано к raw) |

На **одно raw** — **несколько** строк `phase_coverage` (по числу включённых ingest-фаз).

---

## Перепарсить все raw

**Worker/dev лучше остановить** (отдельный CLI поднимет свой процесс).

| Задача | Команда |
|--------|---------|
| Перепарсить все raw (catalog eager + очередь llm; dadata — geo) | `npm run parse-engine:rebuild` |
| То же + сразу прогнать scheduled ingest + geo | `npm run parse-engine:rebuild:drain` |
| Манифест фаз + первый прогон | `npm run parse-engine:init` |
| Догнать очереди (worker должен крутиться или drain) | `npm run parse-engine:drain` |
| Одна фаза | `npm run parse-engine:phase:run -- --phase=llm --batch=100` |

После `rebuild` без `:drain` — scheduled догоняет **worker** (`IngestParseDaemon`) или `npm run parse-engine:ingest:drain`.

---

## Отменить всё запланированное (очереди)

**Сначала:** `Ctrl+C` на `npm run dev` (иначе daemon снова накидает `pending`).

| Задача | Команда |
|--------|---------|
| Снять ingest + geo очереди + cancel runs | `npm run parse-engine:phase:stop` |
| То же из UI | админка **«Стоп всё»** |
| Не крутить фазы снова | админка **ВЫКЛ** у llm / geo-dadata |

Geo (если без админки):

```sql
DELETE FROM place_enrichment_jobs WHERE status IN ('pending', 'processing');
```

Проверка:

```powershell
npm run parse-engine:status
npm run parse-engine:queue:ingest
npm run parse-engine:queue:geo
```

---

## Удалить всё кроме raw

| Задача | Команда |
|--------|---------|
| Сброс parse + карта + очереди, **raw остаётся** | `npm run parse-engine:reset -- --no-catch-up` |
| Только снять pending (результаты parse остаются) | `npm run parse-engine:phase:stop` |

**`reset` не трогает:** `raw_messages`, channels/providers, справочник `places`/`regions`, `phase_definitions`.

**Может остаться после reset:** `place_enrichment_jobs`, `event_evidence`, `domain_events` — при необходимости:

```sql
DELETE FROM place_enrichment_jobs;
DELETE FROM event_evidence;
DELETE FROM domain_events;
```

| ⚠️ Не путать | |
|--------------|---|
| `parse-engine:clear` | удаляет **и raw тоже** |
| `parse-engine:clear:raw` | удаляет **только** raw |

---

## Типовой сценарий «обнулить и заново»

```powershell
# 1. dev остановлен
npm run parse-engine:phase:stop
npm run parse-engine:reset -- --no-catch-up

# 2. опционально geo/SQL выше

# 3. перепарс
npm run parse-engine:rebuild
# или всё под ключ:
npm run parse-engine:rebuild:drain

# 4. dev снова
npm run dev
```

---

## Админка (фазы)

| Кнопка | Эффект |
|--------|--------|
| **ВЫКЛ** | `enabled=false` + **снос очереди** этой фазы (geo jobs / coverage) |
| **Сброс оч.** | только очередь фазы + cancel её runs |
| **Стоп всё** | всё ingest + всё geo (кнопка активна при backlog, не только runs) |
| **Run** | catch-up + drain (**нужен worker**) |

Geo-демон **не создаёт** `phase_runs` — Cancel у run бесполезен, пока демон жрёт очередь; для geo — **Сброс оч.** / **ВЫКЛ** / **Стоп всё**.

---

## Env (минимум parse-engine)

```env
DATABASE_URL=postgresql://radar:radar@127.0.0.1:5432/radar
RADAR_STORAGE_MODE=db
```

Опционально: `DADATA_TOKEN`, Telegram `TELEGRAM_API_ID` / `HASH`, Ollama для LLM.

**Лог geo-dadata в worker:** после каждого батча `GeoParse[geo-dadata] provider=dadata claimed=… ok=… failed=…`. Подробно по местам: `RADAR_VERBOSE_GEO_LOG=1` (ingest dadata виден в `parse:snap` / `EnricherInvoked`, geo — отдельный контур).
