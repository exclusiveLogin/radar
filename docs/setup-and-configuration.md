# Запуск и настройка Radar

**Единая инструкция:** bootstrap → ежедневный workflow → конфигурация (manifest SSOT) → типовые сценарии.

> Канон конфигурации: [ADR-021](rfc/adr-021-manifest-env-ssot.md).  
> CLI: [radar-cli.md](radar-cli.md). Cold start с нуля: [cold-start.md](cold-start.md).

---

## 1. Требования

| Компонент | Версия |
|-----------|--------|
| Node.js | 20+ |
| npm | 10+ |
| Docker Desktop | для Postgres (рекомендуется) |
| PowerShell | Windows (команды ниже) |

---

## 2. Первый запуск (~10 мин)

```powershell
cd C:\path\to\radar
Copy-Item .env.example .env
npm run radar -- stack cold-up
npm run radar -- stack dev
```

| Шаг | Что делает |
|-----|------------|
| `cold-up` | Docker (Postgres + Adminer + pgAdmin), `npm install`, build shared, **миграции** |
| `stack dev` | API :3000 + Web :5173 (без worker) |

**Проверка:**

| URL | Ожидание |
|-----|----------|
| http://127.0.0.1:5173 | UI |
| http://127.0.0.1:3000/api/ready | БД доступна |
| http://127.0.0.1:8080 | Adminer (`db` / `POSTGRES_*` из `.env`) |

**Полный стек (worker на хосте):**

```powershell
npm run radar -- stack dev --full
# или отдельно:
$env:RADAR_STORAGE_MODE="db"
npm run worker:dev
```

---

## 3. Ежедневный workflow

```powershell
npm run radar -- stack up          # Docker + API + Web
npm run radar -- stack dev --full  # + worker (если нужен ingest/parse)
```

Docker-вариант (всё в compose): [docker-dev-stack.md](docker-dev-stack.md)

```powershell
npm run radar -- stack docker-dev
```

---

## 4. Модель конфигурации (ADR-021)

Один контракт для **всех** продуктовых настроек:

```
DEFAULT (TypeScript)
 → {domain}.manifest.json          ← коммит, defaults
  → {domain}.local.manifest.json   ← gitignore, локально
   → {DOMAIN}__a__b__c=env        ← явный override, побеждает всё
    → resolved config              ← единственный вход в код
```

**Правило:** двойной `__` = сегмент JSON-пути.

### Домены

| Домен | Файл (корень репо) | Local override | Env prefix | Что настраивает |
|-------|---------------------|----------------|------------|-----------------|
| **deployment** | `deployment.manifest.json` | `deployment.local.manifest.json` | `DEPLOY__` | runners, obs, process role, compose ports |
| **worker.runtime** | `worker.runtime.manifest.json` | `worker.runtime.local.manifest.json` | `WORKER__` | backfill/parse/geo/tracking daemons, pools |
| **geo.enrichers** | `geo.enrichers.manifest.json` | `geo.enrichers.local.manifest.json` | `GEO__` | dadata/nominatim/llm toggles |
| **ingest** | `ingest.manifest.json` | — | `INGEST__` | провайдеры/bindings (BC: `.radar/ingest.manifest.json`) |

### Примеры override

```powershell
# Runner platform для tracking (вместо legacy daemon)
$env:DEPLOY__runners__pipelines__tracking__schedulingImpl="runner-platform"

# Obs sidecar в Docker
$env:DEPLOY__infra__obs__dockerize="true"
$env:DEPLOY__infra__obs__mode="service"

# Backfill poll interval
$env:WORKER__backfill__pollMs="20000"

# Выключить LLM geocoder
$env:GEO__llm__enabled="0"
```

Или локальный файл (не коммитить):

```json
// deployment.local.manifest.json
{
  "infra": { "obs": { "dockerize": true, "mode": "service" } },
  "runners": {
    "pipelines": [
      { "pipelineKey": "parse", "schedulingImpl": "runner-platform" }
    ]
  }
}
```

> **Legacy env не работают:** `TRACKING_RUNNER_PLATFORM_ENABLED`, `DOCKERIZE_OBS`, `RADAR_OBS_MODE`, `RADAR_BACKFILL_*`, `TRACKING_DAEMON_*` — удалены из runtime.

---

## 5. Что только в `.env`

| Категория | Переменные | Почему не manifest |
|-----------|------------|-------------------|
| **Секреты** | `DADATA_TOKEN`, `POSTGRES_PASSWORD`, `DOTENV_KEY` | не коммитить |
| **Инфра БД** | `DATABASE_URL`, `POSTGRES_*` | Docker/хост топология |
| **Telegram** | `TELEGRAM_API_ID/HASH`, `TELEGRAM_MTPROXY_*` | секреты / прокси |
| **Node/framework** | `NODE_ENV`, `PORT` | framework |
| **Web build** | `VITE_*` | build-time (отдельный домен) |
| **Process** | `RADAR_STORAGE_MODE`, `RADAR_WORKER_ROLE`, `RADAR_SESSIONS_DIR` | роль процесса / режим storage |

Полный шаблон: **`.env.example`** в корне репо.

---

## 6. Сценарии настройки

### 6.1 Host dev — UI + API (без Telegram)

```powershell
Copy-Item .env.example .env
npm run radar -- stack cold-up
npm run radar -- stack dev
```

---

### 6.2 Полный контур с ingest (Telegram → БД)

**A. Сессия (диск, не БД):**

```powershell
npm run radar -- ingest session:deploy
npm run radar -- ingest session:probe
```

**B. Manifest каналов:**

```powershell
npm run radar -- ingest manifest:import
```

**C. Worker db mode** — в `.env`: `RADAR_STORAGE_MODE=db`

```powershell
npm run worker:dev
```

Подробнее: [ingest-providers.md](ingest-providers.md), [backfill-v2-pipeline.md](backfill-v2-pipeline.md).

---

### 6.3 Docker dev (split worker-роли)

```powershell
npm run radar -- stack docker-dev
```

| Сервис | `RADAR_WORKER_ROLE` | Назначение |
|--------|---------------------|------------|
| worker-ingest | `ingest` | live Telegram → outbox |
| worker-backfill | `backfill` | архив jobs |
| worker-phase | `phase` | parse/geo daemons + OutboxRelay |

---

### 6.4 Observability (embedded vs sidecar)

**Default:** `deployment.manifest.json` → `infra.obs.mode=embedded`.

**Sidecar:**

```json
{ "infra": { "obs": { "dockerize": true, "mode": "service" } } }
```

в `deployment.local.manifest.json`, затем `npm run radar -- stack dev --full`.

Подробнее: [runbook/observability.md](runbook/observability.md).

---

### 6.5 Runner platform (dev only)

```powershell
$env:DEPLOY__runners__pipelines__tracking__schedulingImpl="runner-platform"
npm run worker:dev
```

Gate: [runbook/staging-gates.md](runbook/staging-gates.md).

---

### 6.6 Tuning daemons

Файл `worker.runtime.manifest.json` или `WORKER__*` env.

| Секция | Ключевые поля | Default |
|--------|---------------|---------|
| `backfill` | `enabled`, `pollMs` | true, 15s |
| `parse` | `poolSize`, `daemon.pollMs` | 2, 15s |
| `tracking` | `enabled`, `intervalMs` | true, 10s |

---

### 6.7 Geo enrichers + LLM

`geo.enrichers.manifest.json` + `DADATA_TOKEN` в `.env`.  
Ollama: `docker compose --profile llm up -d`, `GEO__llm__enabled=1`.

---

### 6.8 Geo catalog

```powershell
npm run radar -- geo catalog:import
```

---

## 7. Частые проблемы

| Симптом | Решение |
|---------|---------|
| API не стартует (shared) | `npm run build -w @radar/shared` |
| `/api/ready` падает | `npm run db:up`, `DATABASE_URL` |
| Worker `memory` | `.env`: `RADAR_STORAGE_MODE=db` |
| Legacy env не работает | manifest / `DEPLOY__*` / `WORKER__*` |
| Backfill idle | `worker.runtime.manifest.json` → `backfill.enabled` |

---

## 8. Шпаргалка команд

```powershell
npm run radar -- stack cold-up
npm run radar -- stack dev --full
npm run radar -- stack docker-dev
npm run radar -- ingest session:deploy
npm run radar -- ingest manifest:import
npm run radar -- geo catalog:import
```

---

## 9. Дальше

| Документ | Зачем |
|----------|-------|
| [getting-started.md](getting-started.md) | Quickstart, URL-чеклист |
| [cheatsheet.md](cheatsheet.md) | SQL, диагностика |
| [docker-dev-stack.md](docker-dev-stack.md) | Compose overlay |
| [rfc/adr-021-manifest-env-ssot.md](rfc/adr-021-manifest-env-ssot.md) | Канон SSOT |
