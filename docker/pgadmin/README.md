# pgAdmin (Docker)

- Образ: `dpage/pgadmin4`, см. `docker-compose.yml`.
- После `docker compose up -d` откройте **http://127.0.0.1:5050** (или порт из `PGADMIN_PORT`).
- **Вход в pgAdmin:** email и пароль из `.env`. По умолчанию в compose: **`admin@example.com`** / **`radar_pgadmin`** (домены вида `@something.local` pgAdmin 9+ отклоняет — контейнер уходит в restart).
- **Подключение к Postgres:** сервер **radar-db (docker internal)** подхватывается из `servers.json`; пароль БД — ваш `POSTGRES_PASSWORD` (по умолчанию `radar`).

Если меняли `POSTGRES_USER` / `POSTGRES_DB`, отредактируйте `servers.json` или добавьте сервер вручную: Host `db`, порт `5432`.
