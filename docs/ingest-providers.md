# Raw Ingest Providers

Архитектура provider-agnostic ingest: адаптеры → `IngestRawMessageHandler` → outbox → parse pipeline.

## Context Map

| Контекст | Ответственность |
|----------|-----------------|
| **Ingest Acquisition** | сырой текст, dedup, курсоры, дежурство провайдеров |
| **Runtime Credentials** | session slots на volume (MTProto / bot token) |
| **Signal Processing** | classify → geo → `parsed_events` |
| **Operations Read Model** | admin API, timeline |

## Агрегаты и инварианты

Каталог всех `aggregateType` в коде и связь с событиями: **[docs/domain/aggregates.md](./domain/aggregates.md)**. Сквозной поток ingest: **[docs/domain/how-it-works.md#ingest-flow](./domain/how-it-works.md#ingest-flow)**.

| Aggregate | Инварианты |
|-----------|------------|
| `IngestProvider` | `active` только при enabled bindings; `binding_key` уникален в provider |
| `RawMessage` | append-only; dedup identity + hash; sort: `posted_at` UTC + `source_sequence ?? external_message_id` |
| `IngestCursor` | live cursor монотонен вперёд только для `ingest_mode=live`; backfill state не задаёт порядок лога |

## Dedup (composable)

1. **Hash** — `ingestMessageHash()` в `@radar/shared` (universal + `rawPayload` whitelist)
2. **Base identity** — `(channel_id, provider_key, external_message_id, revision_key)`
3. **Telegram extension** — `raw_message_telegram` UNIQUE `(chat_id, message_id, edit_date)`

Duplicate → `RawMessageDuplicate`, parse не вызывается.

## Admin API (`/api/admin/ingest`)

| Method | Path | Назначение |
|--------|------|------------|
| GET | `/providers` | список провайдеров |
| POST | `/providers` | создать |
| POST | `/providers/:id/start` | `status=active` |
| POST | `/messages` | ручной ingest |
| GET | `/messages?channelKey=&anchorPostedAt=&anchorTieBreaker=&direction=` | timeline |
| POST | `/backfill-jobs` | задача backfill (выполняет worker **BackfillDaemon**, см. [backfill-v2-pipeline.md](./backfill-v2-pipeline.md)) |

Swagger: `/api/docs` → tag `admin-ingest`.

---

## CLI — справочник команд (с примерами)

Команды запускаются **из корня репозитория**. Всё после `--` уходит в worker.

**Синтаксис флагов:** `--имя=значение` или `--имя значение`. Одинаково: `--provider-id` и `--providerId`.

### Сначала — три понятия

| Понятие | Простыми словами |
|---------|------------------|
| **Session slot** | Файл с «логином» Telegram на диске. В БД хранится только **имя слота**, не пароль. |
| **Ingest manifest** | Черновик конфига (JSON): какие провайдеры и каналы слушать. Import кладёт в PostgreSQL. |
| **Backfill** | Докачка **старых** сообщений из чата. Live-поток при этом не трогаем. |

**Цепочка в продукте:**

```text
session deploy  →  manifest import (или admin API)  →  provider start  →  worker:dev (live)
                                                              ↓
                                                    backfill (архив по желанию)
```

### Общие env

| Переменная | Когда нужна | За что отвечает |
|------------|-------------|----------------|
| `DATABASE_URL` | manifest, backfill, worker | Подключение к PostgreSQL |
| `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` | session | Ключи приложения с my.telegram.org |
| `RADAR_SESSIONS_DIR` | session | Папка слотов (default `.radar/sessions`) |
| `RADAR_INGEST_MANIFEST` | manifest | Путь к JSON (default `.radar/ingest.manifest.json`) |
| `RADAR_STORAGE_MODE=db` | backfill, worker | Worker пишет в БД, не в память |

---

## 1. Session — логин в Telegram

Секреты **не в git и не в БД** — только в `.radar/sessions/{slot}/`.

### `npm run worker:session:deploy`

**Что делает:** один раз логинится в Telegram (телефон + код + 2FA) или принимает bot token, сохраняет сессию на диск.

**Зачем:** без этого worker не сможет читать каналы через user MTProto или bot API.

**Когда:** первый запуск стенда; после `invalidate`; смена аккаунта.

| Параметр | Обяз. | Default | За что отвечает |
|----------|-------|---------|----------------|
| `--slot` | нет | `tg-default-user` | Имя папки слота. Должно совпасть с `credentialRefs.mtprotoSessionSlot` / `botTokenSlot` в provider. |
| `--kind` | нет | `mtproto_user` | `mtproto_user` — личный аккаунт; `bot_token` — бот. |
| `--provider-key` | нет | — | Метка в `artifact.json` (какой provider использует слот). На логику не влияет. |

**Инварианты:**

- Нужен **интерактивный терминал** (TTY) для `mtproto_user`.
- `TELEGRAM_API_ID` и `TELEGRAM_API_HASH` в `.env`.
- Файлы слота **не коммитить** (в `.gitignore`).
- Один `--slot` = один аккаунт/бот; user и bot — **разные** слоты.

**Пример (user-аккаунт для региональных чатов):**

```bash
# 1. В .env: TELEGRAM_API_ID, TELEGRAM_API_HASH
# 2. Деплой — в консоли спросят телефон и код
npm run worker:session:deploy -- --slot tg-user-1 --kind mtproto_user

# 3. Проверка
npm run worker:session:probe -- --slot tg-user-1
# → {"ok":true,"accountHint":"@myusername"}
```

В manifest/provider потом указываешь: `"mtprotoSessionSlot": "tg-user-1"`.

---

### `npm run worker:session:probe`

**Что делает:** подключается к Telegram **без записи** — «жива ли сессия».

**Зачем:** после deploy, после перезагрузки ПК, перед `worker:dev`.

| Параметр | Обяз. | Default | За что отвечает |
|----------|-------|---------|----------------|
| `--slot` | нет | `tg-default-user` | Какой слот проверить |

**Инварианты:** читает уже сохранённый `secret`; если файла нет — `ok: false`.

**Пример:**

```bash
npm run worker:session:probe -- --slot tg-user-1
```

---

### `npm run worker:session:invalidate`

**Что делает:** удаляет артефакты слота (сессия «забыта»).

**Зачем:** `AUTH_KEY_UNREGISTERED`, протухшая сессия, смена аккаунта.

| Параметр | Обяз. | Default | За что отвечает |
|----------|-------|---------|----------------|
| `--slot` | нет | `tg-default-user` | Какой слот сбросить |

**Инварианты:** после invalidate **обязателен** новый `deploy`. Worker с этим слотом упадёт, пока не задеплоишь снова.

**Пример:**

```bash
npm run worker:session:invalidate -- --slot tg-user-1
npm run worker:session:deploy -- --slot tg-user-1 --kind mtproto_user
```

---

## 2. Manifest — конфиг в БД без admin UI

Файл по умолчанию: `.radar/ingest.manifest.json` (можно переопределить `RADAR_INGEST_MANIFEST`).

**Bootstrap:** при `ingest:manifest:import`, если локального файла нет, worker **копирует** bundled-шаблон `docs/examples/ingest.manifest.radar-channels-mtproxy.json` → `.radar/ingest.manifest.json` (4 канала: PF, Russia, RVK, RRPFO). Ручной `Copy-Item` не нужен.

**Важно:** worker в runtime читает **только БД**. Manifest — черновик для import/export.

### `npm run ingest:manifest:import`

**Что делает:** читает JSON и **upsert** в PostgreSQL: provider, channel, binding.

**Зачем:** завести несколько каналов одной командой; хранить конфиг в gitignored JSON.

**Параметров CLI нет** — только env `DATABASE_URL` и путь к файлу.

**Что import делает с каждой entry:**

| Объект | Поведение | Уже есть в БД? |
|--------|-----------|----------------|
| — | `persist: false` → **пропуск** целиком | — |
| **provider** | `findByKey(key)` → insert если нет | Есть → **не обновляет**, берёт существующий `id` |
| **channel** | **upsert** по `key` (создаёт или **обновляет** title, enabled) | Обновляет |
| **binding** | `findByBindingKey` у provider → insert если нет | Есть → **пропуск** |

**Инварианты:**

- Entries с `persist: false` — полностью игнорируются (удобно для «черновиков» в manifest).
- Provider **не обновляется** при повторном import — если нужно поменять `adapterConfig` или `credentialRefs`, используй admin API `PATCH /providers/:id`.
- Binding **не обновляется** — удали через admin API и пересоздай, если нужно поменять `bindingMode` или `externalTarget`.
- Channel — **единственный**, кто реально мержится (upsert): можно обновить title, enabled через manifest.
- Для binding нужен `channelKey` (в `binding.channelKey` или в `channel.key` той же entry).
- Новый provider создаётся в статусе `draft` — активировать: `POST /api/admin/ingest/providers/:id/start`.

### Manifest v2 — формат файла

Файл `.radar/ingest.manifest.json`. Корневой объект:

| Поле | Тип | Обяз. | Описание |
|------|-----|-------|----------|
| `version` | `2` | **да** | Всегда `2`. Ставь ровно цифру, не строку. |
| `entries` | массив | **да** | Список записей (provider + channel + binding). |

#### Как entry превращается в работающую подписку

```
entry
├── provider   → ЧЕМ слушаем (аккаунт / бот / ручной ingest)
│   ├── adapterKind      = какой код adapter поднять (telegram / manual / ...)
│   ├── adapterConfig    = настройки adapter (proxy, poll interval, batch size)
│   └── credentialRefs   = какие session slots использовать для auth
│
├── channel    → ЧТО слушаем (конкретный канал / группа / чат)
│   ├── key              = внутренний стабильный id канала
│   └── telegramTarget   = внешний адрес (@username, t.me/..., peer id)
│
└── binding    → КАК слушаем (связь provider ↔ channel)
    ├── bindingMode      = транспорт + тип чата (user_mtproto_channel, bot_api_group, ...)
    └── externalTarget   = куда adapter реально подключается
```

**Runtime:** worker берёт `provider.adapterKind` → создаёт adapter → adapter читает `credentialRefs` → для каждого binding смотрит `bindingMode` (какой транспорт) + `externalTarget` (куда коннектиться) → подписывается на события.

Пример: `adapterKind: "telegram"` + `credentialRefs.mtprotoSessionSlot: "tg-user-1"` + `bindingMode: "user_mtproto_channel"` + `externalTarget: "@belgorod_alert_channel"` = «user-сессией `tg-user-1` слушай канал `@belgorod_alert_channel` через MTProto».

Каждая **entry** — тройка «кто слушает / какой канал / как именно»:

| Поле | Тип | Обяз. | Описание |
|------|-----|-------|----------|
| `persist` | boolean | **да** | `true` — импортировать в БД; `false` — пропустить (только для заметок). |
| `provider` | object | нет | Провайдер (аккаунт/бот, через который слушаем). |
| `channel` | object | нет | Канал/чат, который слушаем. |
| `binding` | object | нет | Связь provider ↔ channel: режим, target, парсинг. |

---

#### `provider` — кто слушает

| Поле | Тип | Обяз. | Описание | Пример |
|------|-----|-------|----------|--------|
| `key` | string | **да** | Уникальный стабильный ключ (один раз выбрали — не меняем). | `"tg-radar-user-1"` |
| `title` | string | **да** | Человекочитаемое имя для UI/лога. | `"Дежурство Telegram user"` |
| `adapterKind` | enum | **да** | Тип adapter: `"telegram"` \| `"manual"` \| `"webhook"` \| `"rss"`. | `"telegram"` |
| `adapterConfig` | object | **да** | Настройки adapter (зависят от `adapterKind`, см. ниже). | `{ "kind": "telegram" }` |
| `credentialRefs` | object | нет | Ссылки на session slots (имена, **не** сами токены). | `{ "mtprotoSessionSlot": "tg-user-1" }` |

**`adapterConfig`** для `"telegram"`:

> **Почему `kind` дублирует `adapterKind`?** `adapterKind` = какой adapter *поднять*. `adapterConfig.kind` = Zod discriminator для валидации конфига (у telegram, manual, webhook — разные наборы полей). Они совпадают, но роль разная: один выбирает код, другой — схему валидации.

| Поле | Тип | Обяз. | Описание | Пример |
|------|-----|-------|----------|--------|
| `kind` | `"telegram"` | **да** | Zod discriminator — должен совпадать с `adapterKind`. | `"telegram"` |
| `mtproxy` | object | нет | MTProxy-профиль (host/port/secret или env-ключи). | `{ "host": "1.2.3.4", "port": 443, "secret": "..." }` |
| `pollIntervalMs` | number | нет | Интервал опроса bot API (ms). | `2000` |
| `historyBatchSize` | number | нет | Размер пачки при backfill. | `200` |

**`adapterConfig`** для `"manual"`:

```json
{ "kind": "manual" }
```

Больше полей нет. Ручной ingest через admin POST — provider создаётся автоматически.

**`credentialRefs`** — какие session slots использует provider:

| Поле | Тип | Обяз. | Описание | Пример |
|------|-----|-------|----------|--------|
| `mtprotoSessionSlot` | string | нет | Имя слота user MTProto (должен совпадать с `--slot` при `session:deploy`). | `"tg-user-1"` |
| `botTokenSlot` | string | нет | Имя слота bot token. | `"tg-bot-main"` |
| `mtproxyProfile` | string | нет | Профиль MTProxy (сейчас `"default"`, читается из env). | `"default"` |

---

#### `channel` — какой канал/чат слушаем

| Поле | Тип | Обяз. | Описание | Пример |
|------|-----|-------|----------|--------|
| `key` | string | **да** | Стабильный ключ канала (используется в hash, FK, timeline). Один раз выбрали — не меняем. | `"belgorod-alerts"` |
| `telegramTarget` | string | **да** | Идентификатор в Telegram: `@username`, `t.me/invite_link` или числовой peer id строкой. | `"@belgorod_alert_channel"` |
| `title` | string | нет | Человекочитаемое название для UI. | `"БПЛА Белгород"` |
| `enabled` | boolean | нет | `true` (default) — активен; `false` — пропускается worker-ом. | `true` |

---

#### `binding` — как именно слушаем

Связь «provider → channel»: через какой транспорт, с какими настройками.

| Поле | Тип | Обяз. | Описание | Пример |
|------|-----|-------|----------|--------|
| `bindingKey` | string | **да** | Уникальный ключ в рамках provider. | `"belgorod-mtproto"` |
| `channelKey` | string | **\*** | Ключ канала (если не задан — берётся из `channel.key` той же entry). | `"belgorod-alerts"` |
| `externalTarget` | string | **да** | Идентификатор для adapter: `@username`, числовой id, URL. Может совпадать с `telegramTarget`. | `"@belgorod_alert_channel"` |
| `bindingMode` | enum | **да** | Режим подключения (см. таблицу ниже). | `"user_mtproto_channel"` |
| `enabled` | boolean | нет | `true` (default) — worker обрабатывает; `false` — пропускает. | `true` |
| `adapterBinding` | object | нет | Доп. настройки для adapter (зависят от `bindingMode`). | `{}` |

**`bindingMode` — что выбрать:**

> **Важно:** `channel` в системе — это **любой источник сообщений**, не только Telegram-канал. Группа, DM с ботом, supergroup — всё создаёт запись в `channels`. Поле `telegramTarget` — адрес этого источника в Telegram (username, peer id, `"dm"` для личных сообщений).

| Значение | Что слушаем | Транспорт | `telegramTarget` | `externalTarget` |
|----------|-------------|-----------|-------------------|-------------------|
| `user_mtproto_channel` | Публичный/приватный канал (broadcast) | User MTProto (GramJS) | `@channel_name` | `@channel_name` |
| `user_mtproto_group` | Группа / supergroup | User MTProto | `@group_name` или peer id | `@group_name` |
| `bot_api_group` | Группа, куда добавлен бот | Bot API long-poll | `@group_name` или peer id | `@group_name` или chat id |
| `bot_api_dm` | Личные сообщения с ботом | Bot API long-poll | `"dm"` или user id | `"dm"` или конкретный user id |
| `hybrid_user_bot_group` | User + bot слушают одну группу | Оба | `@group_name` | `@group_name` |

### Примеры entry для каждого режима

**Канал через user-сессию** (`user_mtproto_channel`):

```json
{
  "persist": true,
  "provider": {
    "key": "tg-user-1", "title": "User MTProto",
    "adapterKind": "telegram",
    "adapterConfig": { "kind": "telegram" },
    "credentialRefs": { "mtprotoSessionSlot": "tg-user-1" }
  },
  "channel": {
    "key": "belgorod-alerts",
    "telegramTarget": "@belgorod_alert_channel",
    "title": "БПЛА Белгород"
  },
  "binding": {
    "bindingKey": "belgorod-live",
    "externalTarget": "@belgorod_alert_channel",
    "bindingMode": "user_mtproto_channel"
  }
}
```

**Группа через бота** (`bot_api_group`):

```json
{
  "persist": true,
  "provider": {
    "key": "tg-bot-1", "title": "Radar Bot",
    "adapterKind": "telegram",
    "adapterConfig": { "kind": "telegram", "pollIntervalMs": 3000 },
    "credentialRefs": { "botTokenSlot": "tg-bot-main" }
  },
  "channel": {
    "key": "kursk-group",
    "telegramTarget": "@kursk_radar_group",
    "title": "Курск оперативная группа"
  },
  "binding": {
    "bindingKey": "kursk-bot",
    "externalTarget": "@kursk_radar_group",
    "bindingMode": "bot_api_group"
  }
}
```

**Личные сообщения с ботом** (`bot_api_dm`):

```json
{
  "persist": true,
  "provider": {
    "key": "tg-bot-1", "title": "Radar Bot",
    "adapterKind": "telegram",
    "adapterConfig": { "kind": "telegram" },
    "credentialRefs": { "botTokenSlot": "tg-bot-main" }
  },
  "channel": {
    "key": "bot-dm-inbox",
    "telegramTarget": "dm",
    "title": "Входящие DM бота"
  },
  "binding": {
    "bindingKey": "bot-dm-all",
    "externalTarget": "dm",
    "bindingMode": "bot_api_dm"
  }
}
```

> **Какой именно бот?** Определяется через `provider.credentialRefs.botTokenSlot` — это имя слота, в котором лежит токен конкретного бота (задаётся через `session:deploy --slot tg-bot-main --kind bot_token`). Если ботов несколько — это **разные provider** с разными `botTokenSlot`. Аналогично для user-сессий: `mtprotoSessionSlot` определяет конкретный аккаунт.
>
> Для DM: `telegramTarget` и `externalTarget` = `"dm"` — бот слушает **все** входящие личные сообщения. Если нужен конкретный user — укажи его id: `"externalTarget": "123456789"`.

**Гибрид user + bot на одну группу** (`hybrid_user_bot_group`):

```json
[
  {
    "persist": true,
    "provider": {
      "key": "tg-user-1", "title": "User MTProto",
      "adapterKind": "telegram",
      "adapterConfig": { "kind": "telegram" },
      "credentialRefs": { "mtprotoSessionSlot": "tg-user-1" }
    },
    "channel": {
      "key": "donetsk-ops",
      "telegramTarget": "@donetsk_ops_group"
    },
    "binding": {
      "bindingKey": "donetsk-user",
      "externalTarget": "@donetsk_ops_group",
      "bindingMode": "hybrid_user_bot_group"
    }
  },
  {
    "persist": true,
    "provider": {
      "key": "tg-bot-1", "title": "Radar Bot",
      "adapterKind": "telegram",
      "adapterConfig": { "kind": "telegram" },
      "credentialRefs": { "botTokenSlot": "tg-bot-main" }
    },
    "channel": {
      "key": "donetsk-ops",
      "telegramTarget": "@donetsk_ops_group"
    },
    "binding": {
      "bindingKey": "donetsk-bot",
      "externalTarget": "@donetsk_ops_group",
      "bindingMode": "hybrid_user_bot_group"
    }
  }
]
```

> **Hybrid**: две entry с **разными provider**, но один `channel.key` — оба слушают одну группу, dedup по `(chatId, messageId)` не даст дублей.

---

### Полный пример manifest — 2 канала, user + bot

```json
{
  "version": 2,
  "entries": [
    {
      "persist": true,
      "provider": {
        "key": "tg-radar-user-1",
        "title": "Дежурство: user-аккаунт",
        "adapterKind": "telegram",
        "adapterConfig": {
          "kind": "telegram",
          "historyBatchSize": 200
        },
        "credentialRefs": {
          "mtprotoSessionSlot": "tg-user-1"
        }
      },
      "channel": {
        "key": "belgorod-alerts",
        "telegramTarget": "@belgorod_alert_channel",
        "title": "БПЛА Белгород",
        "enabled": true
      },
      "binding": {
        "bindingKey": "belgorod-user-mtproto",
        "channelKey": "belgorod-alerts",
        "externalTarget": "@belgorod_alert_channel",
        "bindingMode": "user_mtproto_channel",
        "enabled": true
      }
    },
    {
      "persist": true,
      "provider": {
        "key": "tg-radar-bot-1",
        "title": "Дежурство: бот",
        "adapterKind": "telegram",
        "adapterConfig": {
          "kind": "telegram",
          "pollIntervalMs": 3000
        },
        "credentialRefs": {
          "botTokenSlot": "tg-bot-main"
        }
      },
      "channel": {
        "key": "kursk-alerts",
        "telegramTarget": "@kursk_alert_group",
        "title": "БПЛА Курск (группа)",
        "enabled": true
      },
      "binding": {
        "bindingKey": "kursk-bot-group",
        "channelKey": "kursk-alerts",
        "externalTarget": "@kursk_alert_group",
        "bindingMode": "bot_api_group",
        "enabled": true
      }
    }
  ]
}
```

### Минимальный пример — один канал

```json
{
  "version": 2,
  "entries": [
    {
      "persist": true,
      "provider": {
        "key": "tg-user-1",
        "title": "User MTProto",
        "adapterKind": "telegram",
        "adapterConfig": { "kind": "telegram" },
        "credentialRefs": { "mtprotoSessionSlot": "tg-user-1" }
      },
      "channel": {
        "key": "my-channel",
        "telegramTarget": "@my_channel"
      },
      "binding": {
        "bindingKey": "my-channel-live",
        "externalTarget": "@my_channel",
        "bindingMode": "user_mtproto_channel"
      }
    }
  ]
}
```

> `channel.title`, `channel.enabled`, `binding.channelKey`, `binding.enabled` — опциональны, подставятся defaults.

### Import

```bash
npm run ingest:manifest:import
# → Import OK: { providers: 1, channels: 1, bindings: 1 }
```

После import provider в статусе **`draft`** — активировать: `POST /api/admin/ingest/providers/:id/start`.

---

### `npm run ingest:manifest:export`

**Что делает:** выгружает **всё** из БД (providers + bindings) обратно в JSON.

**Зачем:** бэкап конфига, правка руками, перенос на другой стенд.

**Параметров CLI нет.**

**Инварианты:** все записи в файле получают `persist: true`; секреты сессий **не** попадают в export (только `credentialRefs`).

**Пример:**

```bash
npm run ingest:manifest:export
# → Export OK: ...\.radar\ingest.manifest.json (3 entries)
```

---

## 3. Backfill — докачка истории

> **Полная документация V2 (схемы, бизнес, эксплуатация):** [docs/backfill-v2-pipeline.md](./backfill-v2-pipeline.md)  
> **Пошаговый запуск (PowerShell, env, API, SQL):** [backfill-v2-pipeline.md § Инструкция по запуску](./backfill-v2-pipeline.md#инструкция-по-запуску-backfill-v2)

### Backfill V2 — автоматический (рекомендуется)

**Что делает:** оператор создаёт задачу через Admin API; worker **BackfillDaemon** в фоне стримит историю (`iterMessages`), после каждого сообщения пишет чекпоинт, parse идёт в `worker_threads`.

| Шаг | Действие |
|-----|----------|
| 1 | `POST /api/admin/ingest/backfill-jobs` — `strategy`: `full_history` / `all` / `by_date_range` / `by_external_id_range` |
| 2 | Worker в `RADAR_STORAGE_MODE=db` (демон включён по умолчанию) |
| 3 | Статус в `ingest_backfill_jobs`: `pending` → `running` → `completed` \| `failed` |

**Стратегия «вся история»:** `{ "bindingId": "<uuid>", "strategy": "all", "params": {} }`.

### `npm run worker:ingest:backfill` — разовый chunk (CLI)

**Что делает:** за **один запуск** выкачивает **одну пачку** старых сообщений (`fetchHistoryBatch`) и кладёт в `raw_messages` с `ingest_mode=backfill`.

**Зачем:** отладка, ручной догон без записи job; повторные запуски — вручную.

**Не путать с V2:** API **не качает** сам — только ставит задачу; качает демон worker.

| Параметр | Обяз. | Default | За что отвечает |
|----------|-------|---------|----------------|
| `--provider-id` | **да*** | — | UUID строки в `ingest_providers` (кто качает) |
| `--binding-id` | **да*** | — | UUID в `ingest_bindings` (какой чат) |
| `--all-bindings` | нет | — | Прогнать backfill по всем enabled bindings (вместо пары id) |
| `--batch-size` | нет | `200` | Сколько сообщений за один проход |
| `--from-posted-at` | нет | — | Не брать сообщения **раньше** этой даты (ISO UTC) |
| `--to-posted-at` | нет | — | Не брать сообщения **позже** этой даты |
| `--from-external-id` | нет | — | Нижняя граница по id сообщения (формат задаёт adapter) |
| `--to-external-id` | нет | — | Верхняя граница по id |

**Инварианты:**

- `RADAR_STORAGE_MODE=db`, БД доступна.
- Provider **telegram**, session slot задеплоен.
- **Live cursor не двигается** — backfill не ломает «что нового».
- Дубликаты (та же revision) → `duplicates++`, parse **не** повторяется.
- Порядок в ленте = `posted_at` + tie-breaker, не `fetched_at`.

**Как взять UUID** (pgAdmin или psql):

```sql
SELECT p.id AS provider_id, b.id AS binding_id, b.binding_key, c.key AS channel_key
FROM ingest_bindings b
JOIN ingest_providers p ON p.id = b.provider_id
LEFT JOIN channels c ON c.id = b.channel_id;
```

**Пример (PowerShell) — один binding:**

```powershell
npm run worker:ingest:backfill -- `
  --provider-id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" `
  --binding-id="11111111-2222-3333-4444-555555555555" `
  --batch-size=100 `
  --from-posted-at="2026-01-01T00:00:00.000Z"
```

**Пример — все enabled bindings (по 100 сообщений на канал):**

```powershell
npm run worker:ingest:backfill -- --all-bindings --batch-size=100
```

**Выход:** `Backfill chunk: { inserted: 42, duplicates: 3 }` — вставлено 42 новых, 3 уже были.

Повторный запуск с теми же сообщениями → в основном `duplicates` (идемпотентно).

---

## 4. `npm run worker:parse:report` (не ingest)

**Что делает:** гоняет **текстовые файлы** через parse pipeline и пишет отчёты — для отладки парсера, не для Telegram.

| Параметр | Default | За что отвечает |
|----------|---------|----------------|
| `--input` | `tests` | Файл `.txt` или папка с ними |
| `--outdir` | `reports` | Куда сохранить результат |
| `--format` | `json` | Формат отчёта: `json` \| `yaml` \| `csv` |
| `--div` | `file` | `file` — один отчёт на txt; `record` — на каждый блок текста |
| `--storage-mode` | `fs` | Режим хранилища worker |
| `--enrich-dadata` | выкл | Подключить геокодер Dadata |
| `--enrich-nominatim` | выкл | Подключить Nominatim |
| `--enrich-llm` | выкл | Подключить LLM |
| `--use-providers` | выкл | Dadata + Nominatim разом |
| `--pipeline-order` | из env | Порядок шагов: `catalog,dadata,nominatim,llm` |

**Пример:**

```bash
npm run worker:parse:report -- --input=tests/snap_001.txt --enrich-dadata
```

---

## Session slots (layout)

```
{RADAR_SESSIONS_DIR}/
  {slotKey}/
    artifact.json   # metadata (kind, authorizedAt, accountHint)
    secret          # StringSession или bot token
```

`ingest_providers.credential_refs` хранит **ключи слотов**, не секреты:

```json
{
  "mtprotoSessionSlot": "tg-user-1",
  "botTokenSlot": "tg-bot-main",
  "mtproxyProfile": "default"
}
```

MTProxy (optional): `TELEGRAM_MTPROXY_HOST`, `TELEGRAM_MTPROXY_PORT`, `TELEGRAM_MTPROXY_SECRET`.

---

## Worker runtime

```bash
RADAR_STORAGE_MODE=db npm run worker:dev
```

- Orchestrator читает `status=active` providers из БД
- `OutboxRelay` доставляет `RawMessageIngested` → `ParseRawMessageHandler` (uuid, не hash)

### Типичный сценарий (чистый стенд)

1. `npm run migration:run`
2. `npm run worker:session:deploy -- --slot tg-user-1 --kind mtproto_user`
3. `npm run ingest:manifest:import` **или** admin API
4. `POST /api/admin/ingest/providers/:id/start`
5. `RADAR_STORAGE_MODE=db npm run worker:dev`

---

## Smoke

1. `npm run migration:run`
2. `POST /api/admin/ingest/messages` с `channelKey` + `rawText`
3. Проверить `raw_messages` и `domain_events` → parse_attempts

---

## Текущие ограничения и будущие задачи

### Что НЕ реализовано сейчас

| Ограничение | Последствие | Будущее решение |
|-------------|-------------|-----------------|
| **Нет gap recovery при рестарте** | При перезапуске worker начинает слушать новые сообщения; пропущенные за время простоя **теряются** | Сервис `IngestGapRecoveryService`: читает курсор → дочитывает до live (batch + retry + checkpoint) |
| **Gap recovery live** | Пропуск за время простоя worker не дочитывается автоматически | `IngestGapRecoveryService` (отдельно от Backfill V2) |
| **`ingestMode` не влияет на обработку** | live/backfill/manual → одинаковый pipeline | Приоритизация: live → алерт; backfill → фоновый парсинг без уведомлений |
| **Admin API без auth** | Любой может управлять providers | Guard / API key / JWT на `/api/admin/ingest/*` |
| **Нет admin UI** | Только Swagger / curl / CLI | React-панель поверх admin API |
| **Только Telegram adapter** | webhook, RSS — не реализованы | Новые `IRawIngestAdapter` (webhook, rss) |

### Gap recovery — архитектурный набросок

```
IngestGapRecoveryService
  input:   cursor (last known) + binding
  config:  batchSize, maxRetries, backoffMs, concurrency
  loop:    fetchHistoryBatch → sink → advance checkpoint → repeat
  stop:    достиг live-курсора или сигнал abort
  output:  GapRecoveryCompleted | GapRecoveryFailed
  
  Приоритет: live > gap recovery (throttle при нагрузке)
  ~80% логики уже в runBackfillChunk; нужна обёртка с циклом и retry policy
```

### Хранение данных — текущая модель

```
raw_messages
├── rawText         ← текст как есть
├── rawPayload      ← JSONB: полный оригинал от источника (entities, media, metadata)
├── hash            ← SHA-256 content fingerprint для dedup
└── ingestMode      ← live | backfill | manual

raw_message_telegram (O2O extension)
├── chatId + messageId + editDate  ← UNIQUE индекс для Telegram-specific dedup
└── peerType                       ← channel | group | supergroup | user
```

`rawPayload` — полный оригинал, всегда можно перепарсить. Универсальные поля (`rawText`, `postedAt`) — выжимка для pipeline.
