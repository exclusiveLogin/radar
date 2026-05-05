# @radar/admin-bot (HLD skeleton)

Этот пакет пока содержит только high-level design каркас без бизнес-логики.

## Команды (план)

- `/stats` — агрегированные метрики и счетчики по событиям.
- `/alerts` — поток критичных уведомлений.
- `/errors` — последние ошибки парсинга/обогащения.
- `/sync` — статус и история geo sync.
- `/health` — проверка доступности сервисов.

## Подписка на Domain Events

- Источник: outbox таблица `domain_events`.
- Чекпоинт: `event_subscriptions` (по подписчику бота).
- Режим: polling или `LISTEN/NOTIFY` (после стабилизации relay).

## Доступ

- Разрешены только user id из `RADAR_ADMIN_BOT_ALLOWED_USER_IDS`.

## Статус

- Только HLD-каркас.
- TODO: Telegram transport, команды, Outbox consumer, retry policy.
