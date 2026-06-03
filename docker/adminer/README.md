# Adminer (Docker)

- Образ: `adminer:4`, см. `docker-compose.yml`.
- После `docker compose up -d` откройте **http://127.0.0.1:8080** (или порт из `ADMINER_PORT`).
- **Вход:** движок **PostgreSQL**, сервер **`db`** (подставляется по умолчанию), логин/пароль/БД — как `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` в `.env` (по умолчанию `radar` / `radar` / `radar`).
