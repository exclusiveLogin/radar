#!/bin/sh
set -e

DB_HOST="${POSTGRES_HOST:-db}"
DB_PORT="${POSTGRES_PORT:-5432}"
DB_USER="${POSTGRES_USER:-radar}"
DB_NAME="${POSTGRES_DB:-radar}"

echo "[entrypoint] Ожидание Postgres ${DB_HOST}:${DB_PORT}..."
TRIES=0
until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; do
  TRIES=$((TRIES + 1))
  if [ "$TRIES" -ge 60 ]; then
    echo "[entrypoint] Postgres недоступен после ${TRIES} попыток" >&2
    exit 1
  fi
  echo "[entrypoint] попытка ${TRIES}/60..."
  sleep 2
done
echo "[entrypoint] Postgres готов."

if [ ! -d node_modules ] || [ ! -f node_modules/.package-lock.json ]; then
  echo "[entrypoint] npm ci..."
  npm ci
fi

echo "[entrypoint] build @radar/shared + @radar/api (worker entity dist)..."
npm run build -w @radar/shared
npm run build -w @repo/root
npm run build -w @radar/api

echo "[entrypoint] exec: $*"
exec "$@"
