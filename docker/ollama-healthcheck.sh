#!/bin/sh
# Healthy = serve отвечает и RADAR_LLM_MODEL присутствует в volume.
set -eu

MODEL="${RADAR_LLM_MODEL:-qwen2.5:3b}"

ollama list >/dev/null 2>&1 || exit 1
ollama show "$MODEL" >/dev/null 2>&1 || exit 1
