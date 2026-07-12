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

wait_for_file() {
  path="$1"
  label="$2"
  tries=0
  until [ -f "$path" ]; do
    tries=$((tries + 1))
    if [ "$tries" -ge 180 ]; then
      echo "[entrypoint] $label не появился: $path" >&2
      exit 1
    fi
    sleep 1
  done
}

wait_api_ready() {
  url="${API_READY_URL:-http://api:3000/api/ready}"
  echo "[entrypoint] ждём API ready: ${url}"
  tries=0
  until U="$url" node -e 'fetch(process.env.U).then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))'; do
    tries=$((tries + 1))
    if [ "$tries" -ge 180 ]; then
      echo "[entrypoint] API ready timeout: ${url}" >&2
      exit 1
    fi
    sleep 1
  done
}

# Bootstrap на общем bind-mount: clean+build — до compose (`npm run dev:prepare`).
# Entrypoint контейнеров dist не сносит; api — fallback build если dist пустой.
API_DIST_MARK=packages/api/dist/infrastructure/persistence/index.js
WORKER_DIST_MARK=packages/worker/dist/application/parse/parsePipeline.worker.js

ensure_api_dist_fallback() {
  if [ -f "$API_DIST_MARK" ] && [ -f "$WORKER_DIST_MARK" ]; then
    echo "[entrypoint] dist на volume — skip build (запускайте через npm run docker:dev)"
    return 0
  fi
  echo "[entrypoint] dist неполный — incremental build (лучше: npm run dev:prepare до compose)"
  npm run build -w @radar/shared
  npm run build -w @radar/observability
  npm run build -w @repo/root
  npm run build -w @radar/api
  npm run build -w @radar/worker
}

case " $* " in
  *"@radar/worker"*)
    echo "[entrypoint] worker: ждём dist..."
    wait_for_file "$API_DIST_MARK" "api persistence dist"
    wait_for_file "$WORKER_DIST_MARK" "worker dist"
    wait_api_ready
    ;;
  *"@radar/web"*)
    echo "[entrypoint] web: ждём api ready..."
    wait_api_ready
    ;;
  *)
    ensure_api_dist_fallback
    wait_for_file "$API_DIST_MARK" "api persistence dist"
    wait_for_file "$WORKER_DIST_MARK" "worker dist"
    ;;
esac

echo "[entrypoint] exec: $*"
exec "$@"
