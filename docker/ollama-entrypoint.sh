#!/bin/sh
# Ollama в docker:dev: persistent volume + ensure RADAR_LLM_MODEL при старте.
set -eu

MODEL="${RADAR_LLM_MODEL:-qwen2.5:3b}"
export OLLAMA_HOST="${OLLAMA_HOST:-0.0.0.0:11434}"

echo "[ollama] data dir: /root/.ollama (volume radar_ollama_data)"
echo "[ollama] target model: ${MODEL}"

ollama serve &
SERVE_PID=$!

# API готов, когда CLI отвечает (curl в образе может отсутствовать).
wait_api() {
  tries=0
  until ollama list >/dev/null 2>&1; do
    tries=$((tries + 1))
    if [ "$tries" -ge 180 ]; then
      echo "[ollama] API не поднялся за 180s" >&2
      kill "$SERVE_PID" 2>/dev/null || true
      exit 1
    fi
    sleep 1
  done
}

wait_api

if ollama show "$MODEL" >/dev/null 2>&1; then
  echo "[ollama] model уже в volume: ${MODEL}"
else
  echo "[ollama] pull ${MODEL} (первый старт может занять долго)..."
  ollama pull "$MODEL"
fi

echo "[ollama] ready"
wait "$SERVE_PID"
