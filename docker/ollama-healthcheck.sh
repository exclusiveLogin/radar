#!/bin/sh
# Healthy = serve отвечает и GEO__llm__model присутствует в volume.
set -eu

MODEL="${GEO__llm__model:-qwen2.5:14b}"

ollama list >/dev/null 2>&1 || exit 1
ollama show "$MODEL" >/dev/null 2>&1 || exit 1
