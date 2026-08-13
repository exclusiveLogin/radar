import { type CliFlagMap, readStringFlag } from "./workerCliArgs.js";

/** Итоговая конфигурация LLM-провайдера (ollama) после слияния env и CLI. */
export type OllamaLlmConfig = { baseUrl: string; model: string };

const DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_MODEL = "qwen2.5:3b";

/**
 * Включает LLM-геокодер и переносит `--base-url`/`--model` в env.
 * Порядок: .env уже загружен вызывающим, CLI-флаги имеют приоритет.
 *
 * SSOT включения enricher — geo.enrichers.manifest + GEO__ overlay;
 * RADAR_LLM_* оставляем для совместимости / клиентов, но без GEO__llm__enabled
 * LlmEnricher вернёт reason=disabled.
 */
export function applyLlmEnv(map: CliFlagMap): OllamaLlmConfig {
  const baseUrl = readStringFlag(map, ["base-url"]);
  const model = readStringFlag(map, ["model"]);

  process.env.RADAR_LLM_GEOCODER_ENABLED = "1";
  process.env.RADAR_LLM_PROVIDER = process.env.RADAR_LLM_PROVIDER || "ollama";
  if (baseUrl) process.env.RADAR_LLM_BASE_URL = baseUrl;
  if (model) process.env.RADAR_LLM_MODEL = model;

  // Manifest overlay (реально читается loadLlmRuntimeConfig).
  process.env.GEO__llm__enabled = "true";
  process.env.GEO__llmValidator__enabled = "true";
  if (process.env.RADAR_LLM_BASE_URL) {
    process.env.GEO__llm__baseUrl = process.env.RADAR_LLM_BASE_URL;
    process.env.GEO__llmValidator__baseUrl = process.env.RADAR_LLM_BASE_URL;
  }
  if (process.env.RADAR_LLM_MODEL) {
    process.env.GEO__llm__model = process.env.RADAR_LLM_MODEL;
    process.env.GEO__llmValidator__model = process.env.RADAR_LLM_MODEL;
  }
  if (process.env.RADAR_LLM_TIMEOUT_MS) {
    process.env.GEO__llm__timeoutMs = process.env.RADAR_LLM_TIMEOUT_MS;
    process.env.GEO__llmValidator__timeoutMs = process.env.RADAR_LLM_TIMEOUT_MS;
  }

  return {
    baseUrl: process.env.RADAR_LLM_BASE_URL || DEFAULT_BASE_URL,
    model: process.env.RADAR_LLM_MODEL || DEFAULT_MODEL,
  };
}

/** Проверяет доступность ollama и наличие модели через `/api/tags`. */
async function probeOllama(
  config: OllamaLlmConfig,
): Promise<{ ok: boolean; status?: number; models: string[] }> {
  const url = new URL("/api/tags", config.baseUrl).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    if (!response.ok) {
      return { ok: false, status: response.status, models: [] };
    }
    const body = (await response.json()) as { models?: Array<{ name?: string }> };
    const models = (body.models ?? []).map((m) => m.name).filter(Boolean) as string[];
    const hasModel =
      models.includes(config.model) ||
      models.some((name) => name.startsWith(`${config.model}:`));
    return { ok: hasModel, status: response.status, models };
  } catch {
    return { ok: false, models: [] };
  } finally {
    clearTimeout(timer);
  }
}

/** Preflight: бросает ошибку с подсказкой по Windows, если ollama/модель недоступны. */
export async function assertOllamaReady(config: OllamaLlmConfig): Promise<void> {
  const probe = await probeOllama(config);
  if (probe.ok) return;

  const modelsHint =
    probe.models.length > 0
      ? `Доступные модели: ${probe.models.join(", ")}`
      : "Список моделей пуст.";
  throw new Error(
    `Ollama: модель "${config.model}" не найдена на ${config.baseUrl} (status=${probe.status ?? "n/a"}). ${modelsHint}\n` +
      "Частая причина на Windows: локальный ollama.exe на 127.0.0.1:11434 (пустой), а Docker с моделями на другом порту.\n" +
      "Fix: 1) закрой Ollama Desktop, или 2) OLLAMA_PORT=11435 в .env + RADAR_LLM_BASE_URL=http://127.0.0.1:11435/v1 + docker compose --profile llm up -d ollama, или 3) ollama pull в локальный Ollama.",
  );
}
