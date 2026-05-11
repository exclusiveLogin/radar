---
name: radar-monorepo
description: >-
  Архитектура монорепо Radar (packages api web worker shared), скрипты npm,
  БД/geo и типичные потоки разработки. Использовать при смене пакета, навигации
  по коду или вопросах «куда положить фичу / миграцию / событие».
disable-model-invocation: true
---

# Radar — монорепозиторий

## Структура

| Пакет | Роль |
|-------|------|
| `packages/shared` | Общие типы и события; собирается первым для остальных пакетов |
| `packages/api` | NestJS: HTTP API, Swagger `/api/docs`, префикс `api`, TypeORM → Postgres |
| `packages/web` | Клиент (Vite/React) |
| `packages/worker` | Воркер: ingest, парсинг, geo-пайплайн, Telegram и т.д. |
| `packages/admin-bot` | Отдельный сервис (см. `package.json` root) |

Корень: `docker-compose.yml`, `.env` (часто путь вида `../../.env` из пакетов), корневые npm-скрипты как единая точка входа.

## Команды (из корня репозитория)

| Сценарий | Команда |
|---------|---------|
| Подъём всего локально | `npm run dev` (или `npm run up` с docker) |
| API / web / worker по отдельности | `npm run api:dev`, `npm run web:dev`, `npm run worker:dev` |
| Линт / типы | `npm run lint`, `npm run typecheck` |
| Сборка всего | `npm run build` |
| Postgres + миграции API | см. `npm run migration:run`, `migration:generate` через workspace `@radar/api` |
| Geo (вендор, сиды и т.д.) | `npm run geo:*` в корне |

## Слои (концептуально)

- **API**: Nest модули, контроллеры, persistence TypeORM (`infrastructure/persistence`, `read-side`).
- **Worker**: доменный парсинг в `domain/parsing`, приложение/handlers/enrichers, geo-каталог.
- **Shared**: контракты событий и общие утилиты — без тяжёлых зависимостей конкретного рантайма.

При добавлении кросс-пакетной логики сначала оценить, не принадлежит ли она `shared` или доменному слою без утечек инфраструктуры.

## Окружение

- Postgres через `DATABASE_URL` (Nest + TypeORM в `packages/api`).
- Не предполагать POSIX-пути при подсказках пользователю: целевая ОС включает **Windows**.
