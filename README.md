# Radar

Скелет монорепозитория для сайта «радар» (карты + Telegram-ингест). **Первый этап:** только инфраструктура и smoke-эндпоинты, без бизнес-логики.

Продуктовый и архитектурный план: [docs/plan.md](docs/plan.md) — удобно подключать в Cursor как контекст.

## Стек

- **Монорепозиторий:** npm workspaces — `packages/api`, `packages/worker`, `packages/web`, **`packages/shared`** (общие Zod-схемы и типы)
- **API:** NestJS, TypeORM, PostgreSQL, Swagger UI по адресу `/api/docs`
- **pgAdmin:** в Docker, см. [docker/pgadmin/README.md](docker/pgadmin/README.md) (порт по умолчанию **5050**)
- **Worker:** GramJS (user MTProto), сессия в корне репозитория (см. ниже)
- **Web:** Vite + React, прокси `/api` → `http://127.0.0.1:3000`

## Быстрый старт (Windows)

### Холодный старт (новая машина / чистый клон)

1. Скопировать **`.env.example` → `.env`** (в корне).
2. Выполнить **`npm run cold:up`** — поднимет Docker (БД + pgAdmin), `npm install`, сборка `@radar/shared`, миграции. Дождаться «Готово», затем **`npm run dev`**.
   - С гео-пайплайном (долго, нужен интернет):  
     `npm run cold:up -- -Geo`
   - Сразу дев-серверы без отдельного `npm run dev`:  
     `npm run cold:up -- -Dev`
   - Вместе: `npm run cold:up -- -Geo -Dev`

**`npm run up`** — по-прежнему только «Docker + dev» без установки зависимостей и миграций (на каждый день).

---

### Пошагово вручную

1. Скопировать `.env.example` в `.env` в **корне** репозитория и заполнить переменные (минимум `DATABASE_URL` для API).
2. Поднять PostgreSQL:

   ```bash
   docker compose up -d
   ```

3. Установить зависимости и применить миграции:

   ```bash
   npm install
   # Windows PowerShell: $env:DATABASE_URL = "postgresql://radar:radar@127.0.0.1:5432/radar"
   # bash: export DATABASE_URL="postgresql://radar:radar@127.0.0.1:5432/radar"
   npm run migration:run
   ```

   (Логин/пароль/БД по умолчанию совпадают с `docker-compose.yml`; при смене — поправьте строку подключения.)

4. Запуск в разработке — **без ручного `build` перед стартом**:
   - **`npm run up`** — одна команда: Postgres в Docker и **все** дев-процессы (shared, API, web, worker). Перед первым запуском API выполните миграции (шаг 3).
   - **`npm run dev`** — то же по приложениям, **без** старта Docker (БД уже должна быть доступна).
   - **`npm run dev:app`** — только shared + API + web, **без** worker (удобно без Telegram).
   - Транспиляция на лету: **Nest** и **shared** инкрементально компилируют TypeScript при сохранении; **Vite** — для клиента; **worker** — `tsx watch`.
   - Vite для `@radar/shared` смотрит на **исходники** (`packages/shared/src`), чтобы не упираться в CJS interop; Node (API) по-прежнему импортирует собранный **`dist`** пакета.
   - Только API: нужен актуальный `dist` у shared — либо второй терминал `npm run shared:dev`, либо один раз из корня уже запускали `npm run dev`.
   - Если правили **только** `packages/shared`, а Nest не пересобрался, сохраните любой файл в `packages/api/src` или перезапустите процесс API.

5. Проверка:

   - [http://127.0.0.1:3000/api/health](http://127.0.0.1:3000/api/health) — без БД  
   - [http://127.0.0.1:3000/api/ready](http://127.0.0.1:3000/api/ready) — `SELECT 1`  
   - [http://127.0.0.1:3000/api/docs](http://127.0.0.1:3000/api/docs) — Swagger  
   - [http://127.0.0.1:5173](http://127.0.0.1:5173) — фронт (запрос к API через прокси)
   - [http://127.0.0.1:5050](http://127.0.0.1:5050) — pgAdmin (логин/пароль из `.env`, см. `.env.example`)

## Локальные GeoJSON (без submodules)

См. [data/geo/README.md](data/geo/README.md): **`vendor/`** (не в git) → **`geo:sync`** → **`artifacts/`** (коммитимые файлы + манифест).

## Worker и Telegram

- В **корне** клона по умолчанию используется файл `.telegram/session` (каталог в `.gitignore`).
- Если задана **`TELEGRAM_STRING_SESSION`** в `.env`, она имеет приоритет над файлом (удобно для деплоя).
- Нужны **`TELEGRAM_API_ID`** и **`TELEGRAM_API_HASH`** с [my.telegram.org](https://my.telegram.org).
- Первый вход — интерактивный (телефон, код, при необходимости 2FA); удобно запускать **на хосте** с TTY:

  ```bash
  npm run worker:dev
  ```

- После успешного входа в консоль выводится строка сессии для сохранения в vault / `TELEGRAM_STRING_SESSION`.

## Секреты и dotenv-vault

- Пакет **`dotenv-vault` на npm** — это в основном **CLI** (`npx dotenv-vault`), а не замена `dotenv.config()` для расшифровки в рантайме.
- Локально приложения читают **`dotenv`** и корневой **`.env`** (не коммитится).
- Для зашифрованного репозиторного следа секретов используйте рабочий процесс **dotenv-vault / dotenvx** по их документации и пробрасывайте уже расшифрованные переменные в процесс (или подключите, например, **`@dotenvx/dotenvx`** при необходимости). Файл **`.env.vault`** можно коммитить; ключи — нет.

## Миграции TypeORM

Генерация (пример имени — последний аргумент):

```bash
npm run migration:generate -- src/migrations/RenameMe
```

Применение:

```bash
npm run migration:run
```

Команды выполняются в пакете `@radar/api` через корневые npm-скрипты.

## Полезные скрипты (корень)

| Скрипт            | Назначение                          |
|-------------------|-------------------------------------|
| `npm run cold:up` | холодный старт: Docker, `npm install`, build shared, миграции (без `dev`) |
| `npm run up`      | **Docker + dev** — без установки/миграций (ежедневная работа) |
| `npm run dev`     | все dev-процессы **без** `docker compose` |
| `npm run dev:app` | shared + API + web (**без** worker) |
| `npm run start:api` | прод: `node dist/main.js` у API (**нужен** предварительный `npm run build`) |
| `npm run db:up`   | `docker compose up -d` (Postgres + **pgAdmin**) |
| `npm run db:down` | `docker compose down`               |
| `npm run geo:vendor` | shallow clone в `data/geo/vendor` (игнор git) |
| `npm run geo:vendor:pull` | обновить клоны в `vendor/` |
| `npm run geo:sync` | копия в **`data/geo/artifacts`** + `manifest.json` (**коммитим**) |
| `npm run geo:seed` | заполнить **`geo_dataset_file`** из манифеста |
| `npm run build`   | сборка всех пакетов, где есть build |
| `npm run lint`    | ESLint по исходникам                 |
| `npm run typecheck` | `tsc --noEmit` в пакетах         |

## Коммит

Запись git не выполнялась с нашей стороны. Предлагаемое сообщение:

`chore: scaffold TS monorepo with Docker DB, TypeORM, and GramJS session bootstrap`
